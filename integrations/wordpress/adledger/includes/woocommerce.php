<?php
/**
 * WooCommerce: store the AdLedger visitor id on orders and send payments/refunds to the
 * AdLedger Conversions API (POST /api/v1/conversions).
 *
 * Sending happens in a background Action Scheduler job (bundled with WooCommerce), so
 * checkout is never slowed down. Each request has a 5 second timeout; failures are logged
 * to WooCommerce → Status → Logs (source "adledger") and retried up to 3 times.
 *
 * @package AdLedger
 */

defined( 'ABSPATH' ) || exit;

const ADLEDGER_META_VID      = '_adledger_vid';
const ADLEDGER_META_QUEUED   = '_adledger_payment_queued';
const ADLEDGER_SEND_HOOK     = 'adledger_send_conversion';
const ADLEDGER_MAX_ATTEMPTS  = 3;

/**
 * Clean a visitor id; returns '' when it doesn't look like one.
 *
 * @param mixed $vid Raw value.
 * @return string
 */
function adledger_clean_vid( $vid ) {
	$vid = is_string( $vid ) ? trim( $vid ) : '';
	return preg_match( '/^[A-Za-z0-9_-]{8,64}$/', $vid ) ? $vid : '';
}

/**
 * Visitor id from the pixel's first-party cookie.
 *
 * @return string
 */
function adledger_cookie_vid() {
	// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- validated by adledger_clean_vid().
	return isset( $_COOKIE['_al_vid'] ) ? adledger_clean_vid( wp_unslash( $_COOKIE['_al_vid'] ) ) : '';
}

/**
 * Save the visitor id on the order (HPOS-safe).
 *
 * @param WC_Order $order Order.
 * @param string   $vid   Visitor id.
 */
function adledger_set_order_vid( $order, $vid ) {
	if ( ! $order || '' === $vid || '' !== (string) $order->get_meta( ADLEDGER_META_VID ) ) {
		return;
	}
	$order->update_meta_data( ADLEDGER_META_VID, $vid );
	$order->save();
}

// Classic checkout: hidden field that assets/adledger-wp.js fills with the visitor id.
add_action(
	'woocommerce_after_order_notes',
	function () {
		echo '<input type="hidden" name="adledger_vid" id="adledger_vid" value="" />';
	}
);

add_action(
	'woocommerce_checkout_update_order_meta',
	function ( $order_id ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- WooCommerce verified the checkout nonce; value validated below.
		$vid = isset( $_POST['adledger_vid'] ) ? adledger_clean_vid( wp_unslash( $_POST['adledger_vid'] ) ) : '';
		adledger_set_order_vid( wc_get_order( $order_id ), '' !== $vid ? $vid : adledger_cookie_vid() );
	}
);

// Block checkout (Store API): read the pixel cookie that came with the request.
add_action(
	'woocommerce_store_api_checkout_update_order_from_request',
	function ( $order ) {
		adledger_set_order_vid( $order, adledger_cookie_vid() );
	}
);

/**
 * Queue a conversion to be sent in the background.
 *
 * @param string $kind      "payment" or "refund".
 * @param int    $order_id  Order id.
 * @param int    $refund_id Refund id (refunds only).
 */
function adledger_queue_conversion( $kind, $order_id, $refund_id = 0 ) {
	$s = adledger_settings();
	if ( ! $s['woo_server'] || '' === $s['api_key'] || '' === $s['url'] ) {
		return;
	}
	$args = array( $kind, (int) $order_id, (int) $refund_id, 1 );
	if ( function_exists( 'as_enqueue_async_action' ) ) {
		as_enqueue_async_action( ADLEDGER_SEND_HOOK, $args, 'adledger' );
	} else {
		adledger_send_conversion( ...$args );
	}
}

/**
 * Payment: when an order becomes processing or completed (sent once per order).
 *
 * @param int $order_id Order id.
 */
function adledger_on_order_paid( $order_id ) {
	$order = wc_get_order( $order_id );
	if ( ! $order || $order->get_meta( ADLEDGER_META_QUEUED ) ) {
		return;
	}
	$s = adledger_settings();
	if ( ! $s['woo_server'] || '' === $s['api_key'] || '' === $s['url'] ) {
		return;
	}
	$order->update_meta_data( ADLEDGER_META_QUEUED, time() );
	$order->save();
	adledger_queue_conversion( 'payment', $order_id );
}
add_action( 'woocommerce_order_status_processing', 'adledger_on_order_paid' );
add_action( 'woocommerce_order_status_completed', 'adledger_on_order_paid' );

add_action(
	'woocommerce_order_refunded',
	function ( $order_id, $refund_id ) {
		adledger_queue_conversion( 'refund', $order_id, $refund_id );
	},
	10,
	2
);

/**
 * Decimal string in the store's precision, e.g. "49.99" (never a float in the payload).
 *
 * @param mixed $value Amount.
 * @return string
 */
function adledger_amount( $value ) {
	return (string) wc_format_decimal( abs( (float) $value ), wc_get_price_decimals() );
}

/**
 * ISO-8601 UTC timestamp.
 *
 * @param WC_DateTime|null $date Date.
 * @return string
 */
function adledger_iso( $date ) {
	return gmdate( 'Y-m-d\TH:i:s\Z', $date ? $date->getTimestamp() : time() );
}

/**
 * Customer fields shared by payment and refund events.
 *
 * @param WC_Order $order Order.
 * @return array
 */
function adledger_customer_fields( $order ) {
	$fields = array(
		'email'      => (string) $order->get_billing_email(),
		'phone'      => (string) $order->get_billing_phone(),
		'name'       => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
		'visitor_id' => (string) $order->get_meta( ADLEDGER_META_VID ),
	);
	return array_filter( $fields, 'strlen' );
}

/**
 * Build the Conversions API event.
 *
 * @param string $kind      "payment" or "refund".
 * @param int    $order_id  Order id.
 * @param int    $refund_id Refund id.
 * @return array|null
 */
function adledger_build_event( $kind, $order_id, $refund_id ) {
	$order = wc_get_order( $order_id );
	if ( ! $order instanceof WC_Order ) {
		return null;
	}
	if ( 'refund' === $kind ) {
		$refund = wc_get_order( $refund_id );
		if ( ! $refund instanceof WC_Order_Refund ) {
			return null;
		}
		$event = array(
			'type'                => 'refund',
			'external_id'         => (string) $refund->get_id(),
			'related_external_id' => (string) $order->get_id(),
			'amount'              => adledger_amount( $refund->get_amount() ),
			'currency'            => $order->get_currency(),
			'occurred_at'         => adledger_iso( $refund->get_date_created() ),
		);
	} else {
		$paid  = $order->get_date_paid() ? $order->get_date_paid() : $order->get_date_created();
		$event = array(
			'type'        => 'payment',
			'external_id' => (string) $order->get_id(),
			'amount'      => adledger_amount( $order->get_total() ),
			'currency'    => $order->get_currency(),
			'occurred_at' => adledger_iso( $paid ),
		);
	}
	$event['source'] = 'woocommerce';
	/**
	 * Filter the event sent to the AdLedger Conversions API.
	 *
	 * @param array    $event Event.
	 * @param WC_Order $order Order.
	 * @param string   $kind  "payment" or "refund".
	 */
	return apply_filters( 'adledger_conversion_event', array_merge( $event, adledger_customer_fields( $order ) ), $order, $kind );
}

/**
 * Send one conversion (runs in the background via Action Scheduler).
 *
 * @param string $kind      "payment" or "refund".
 * @param int    $order_id  Order id.
 * @param int    $refund_id Refund id.
 * @param int    $attempt   Attempt number, starting at 1.
 */
function adledger_send_conversion( $kind, $order_id, $refund_id = 0, $attempt = 1 ) {
	$s = adledger_settings();
	if ( '' === $s['api_key'] || '' === $s['url'] ) {
		return;
	}
	$event = adledger_build_event( $kind, (int) $order_id, (int) $refund_id );
	if ( ! $event ) {
		return;
	}
	$response = wp_remote_post(
		$s['url'] . '/api/v1/conversions',
		array(
			'timeout'     => 5,
			'headers'     => array(
				'Authorization' => 'Bearer ' . $s['api_key'],
				'Content-Type'  => 'application/json',
			),
			'body'        => wp_json_encode( array( 'events' => array( $event ) ) ),
			'data_format' => 'body',
		)
	);
	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	if ( $code >= 200 && $code < 300 ) {
		return;
	}

	$retry  = ( 0 === $code || 429 === $code || $code >= 500 ) && $attempt < ADLEDGER_MAX_ATTEMPTS && function_exists( 'as_schedule_single_action' );
	$reason = is_wp_error( $response ) ? $response->get_error_code() : 'HTTP ' . $code;
	// Never log the API key or customer details, only ids and the status.
	wc_get_logger()->warning(
		sprintf( 'Could not send %1$s for order #%2$d (attempt %3$d): %4$s.%5$s', $kind, $order_id, $attempt, $reason, $retry ? ' Will retry.' : '' ),
		array( 'source' => 'adledger' )
	);
	if ( $retry ) {
		as_schedule_single_action( time() + 300 * $attempt, ADLEDGER_SEND_HOOK, array( $kind, (int) $order_id, (int) $refund_id, $attempt + 1 ), 'adledger' );
	}
}
add_action( ADLEDGER_SEND_HOOK, 'adledger_send_conversion', 10, 4 );

// Thank-you page: link this browser to the buyer (works for classic and block checkout).
add_action(
	'wp_footer',
	function () {
		if ( ! function_exists( 'is_order_received_page' ) || ! is_order_received_page() || ! adledger_tracking_enabled() ) {
			return;
		}
		$order_id = absint( get_query_var( 'order-received' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- the order key is the proof of access, as in WooCommerce itself.
		$key   = isset( $_GET['key'] ) ? sanitize_text_field( wp_unslash( $_GET['key'] ) ) : '';
		$order = $order_id ? wc_get_order( $order_id ) : null;
		if ( ! $order instanceof WC_Order || '' === $key || ! hash_equals( $order->get_order_key(), $key ) ) {
			return;
		}
		$traits = adledger_customer_fields( $order );
		unset( $traits['visitor_id'] );
		if ( empty( $traits ) ) {
			return;
		}
		wp_print_inline_script_tag( 'window.adledger&&adledger.identify(' . wp_json_encode( $traits ) . ');', array( 'id' => 'adledger-identify' ) );
	}
);
