<?php
/**
 * Settings → AdLedger page (Settings API; nonces are handled by settings_fields()).
 *
 * @package AdLedger
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the option, section and fields.
 */
function adledger_register_settings() {
	register_setting(
		'adledger',
		ADLEDGER_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'adledger_sanitize_settings',
			'default'           => array(),
			'show_in_rest'      => false,
		)
	);

	add_settings_section( 'adledger_connection', __( 'Connection', 'adledger' ), 'adledger_section_connection', 'adledger' );
	add_settings_field( 'adledger_url', __( 'AdLedger URL', 'adledger' ), 'adledger_field_url', 'adledger', 'adledger_connection', array( 'label_for' => 'adledger_url' ) );
	add_settings_field( 'adledger_site_key', __( 'Site key', 'adledger' ), 'adledger_field_site_key', 'adledger', 'adledger_connection', array( 'label_for' => 'adledger_site_key' ) );
	add_settings_field( 'adledger_api_key', __( 'API key (optional)', 'adledger' ), 'adledger_field_api_key', 'adledger', 'adledger_connection', array( 'label_for' => 'adledger_api_key' ) );

	add_settings_section( 'adledger_options', __( 'Options', 'adledger' ), '__return_false', 'adledger' );
	add_settings_field( 'adledger_forms', __( 'Form leads', 'adledger' ), 'adledger_field_checkbox', 'adledger', 'adledger_options', array(
		'key'   => 'forms',
		'label' => __( 'Record a lead when a visitor submits a form with an email field (Contact Form 7, WPForms, Gravity Forms, Elementor and regular forms).', 'adledger' ),
	) );
	add_settings_field( 'adledger_woo_server', __( 'WooCommerce', 'adledger' ), 'adledger_field_checkbox', 'adledger', 'adledger_options', array(
		'key'   => 'woo_server',
		'label' => __( 'Send WooCommerce purchases and refunds to AdLedger from the server (needs an API key).', 'adledger' ),
	) );
	add_settings_field( 'adledger_skip_admins', __( 'Administrators', 'adledger' ), 'adledger_field_checkbox', 'adledger', 'adledger_options', array(
		'key'   => 'skip_admins',
		'label' => __( "Don't track logged-in administrators.", 'adledger' ),
	) );
}
add_action( 'admin_init', 'adledger_register_settings' );

/**
 * Sanitize the submitted settings.
 *
 * @param mixed $input Raw input.
 * @return array
 */
function adledger_sanitize_settings( $input ) {
	$old   = adledger_settings();
	$input = is_array( $input ) ? $input : array();
	$out   = array();

	$url = isset( $input['url'] ) ? trim( (string) $input['url'] ) : '';
	$url = untrailingslashit( esc_url_raw( $url, array( 'https', 'http' ) ) );
	$parts = '' !== $url ? wp_parse_url( $url ) : array();
	if ( '' !== $url && ( empty( $parts['host'] ) || ! in_array( $parts['scheme'] ?? '', array( 'http', 'https' ), true ) ) ) {
		add_settings_error( ADLEDGER_OPTION, 'adledger_url', __( 'The AdLedger URL does not look valid. Example: https://adledger.example.com', 'adledger' ) );
		$url = $old['url'];
	}
	$out['url'] = $url;

	$site_key = isset( $input['site_key'] ) ? sanitize_text_field( (string) $input['site_key'] ) : '';
	if ( '' !== $site_key && ! preg_match( '/^[A-Za-z0-9_-]{8,64}$/', $site_key ) ) {
		add_settings_error( ADLEDGER_OPTION, 'adledger_site_key', __( 'The site key should look like pk_… (copy it from AdLedger → Settings → Tracking).', 'adledger' ) );
		$site_key = $old['site_key'];
	}
	$out['site_key'] = $site_key;

	// The API key is never printed back into the form: blank means "keep the saved one".
	$api_key = isset( $input['api_key'] ) ? sanitize_text_field( (string) $input['api_key'] ) : '';
	if ( ! empty( $input['api_key_clear'] ) ) {
		$api_key = '';
	} elseif ( '' === $api_key ) {
		$api_key = $old['api_key'];
	} elseif ( ! preg_match( '/^[A-Za-z0-9_-]{8,200}$/', $api_key ) ) {
		add_settings_error( ADLEDGER_OPTION, 'adledger_api_key', __( 'The API key should look like al_… (create one in AdLedger → Settings → API keys).', 'adledger' ) );
		$api_key = $old['api_key'];
	}
	$out['api_key'] = $api_key;

	foreach ( array( 'forms', 'woo_server', 'skip_admins' ) as $key ) {
		$out[ $key ] = ! empty( $input[ $key ] );
	}
	return $out;
}

/**
 * Section intro.
 */
function adledger_section_connection() {
	echo '<p>' . esc_html__( 'Find these in your AdLedger dashboard under Settings → Tracking (site key) and Settings → API keys.', 'adledger' ) . '</p>';
}

/**
 * URL field.
 */
function adledger_field_url() {
	$s = adledger_settings();
	printf(
		'<input type="url" class="regular-text" id="adledger_url" name="%1$s[url]" value="%2$s" placeholder="https://adledger.example.com" /><p class="description">%3$s</p>',
		esc_attr( ADLEDGER_OPTION ),
		esc_attr( $s['url'] ),
		esc_html__( 'The address where your AdLedger runs, without a trailing slash.', 'adledger' )
	);
}

/**
 * Site key field.
 */
function adledger_field_site_key() {
	$s = adledger_settings();
	printf(
		'<input type="text" class="regular-text code" id="adledger_site_key" name="%1$s[site_key]" value="%2$s" placeholder="pk_…" autocomplete="off" />',
		esc_attr( ADLEDGER_OPTION ),
		esc_attr( $s['site_key'] )
	);
}

/**
 * API key field (write-only).
 */
function adledger_field_api_key() {
	$s     = adledger_settings();
	$saved = '' !== $s['api_key'];
	printf(
		'<input type="password" class="regular-text code" id="adledger_api_key" name="%1$s[api_key]" value="" placeholder="%2$s" autocomplete="new-password" />',
		esc_attr( ADLEDGER_OPTION ),
		esc_attr( $saved ? __( 'Saved. Leave blank to keep it.', 'adledger' ) : 'al_…' )
	);
	if ( $saved ) {
		printf(
			' <label><input type="checkbox" name="%1$s[api_key_clear]" value="1" /> %2$s</label>',
			esc_attr( ADLEDGER_OPTION ),
			esc_html__( 'Remove saved key', 'adledger' )
		);
	}
	echo '<p class="description">' . esc_html__( 'Only needed to send WooCommerce orders from the server. Stored in the WordPress database.', 'adledger' ) . '</p>';
}

/**
 * Checkbox field.
 *
 * @param array $args Field args with key + label.
 */
function adledger_field_checkbox( $args ) {
	$s = adledger_settings();
	printf(
		'<label><input type="checkbox" name="%1$s[%2$s]" value="1" %3$s /> %4$s</label>',
		esc_attr( ADLEDGER_OPTION ),
		esc_attr( $args['key'] ),
		checked( ! empty( $s[ $args['key'] ] ), true, false ),
		esc_html( $args['label'] )
	);
}

/**
 * Add Settings → AdLedger.
 */
function adledger_admin_menu() {
	add_options_page( __( 'AdLedger', 'adledger' ), __( 'AdLedger', 'adledger' ), 'manage_options', 'adledger', 'adledger_render_page' );
}
add_action( 'admin_menu', 'adledger_admin_menu' );

/**
 * Render the settings page.
 */
function adledger_render_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$s = adledger_settings();
	echo '<div class="wrap"><h1>' . esc_html__( 'AdLedger', 'adledger' ) . '</h1>';
	if ( $s['woo_server'] && class_exists( 'WooCommerce' ) && '' === $s['api_key'] ) {
		echo '<div class="notice notice-warning inline"><p>' . esc_html__( 'Add an API key to send WooCommerce orders and refunds to AdLedger.', 'adledger' ) . '</p></div>';
	}
	echo '<form action="options.php" method="post">';
	settings_fields( 'adledger' );
	do_settings_sections( 'adledger' );
	submit_button();
	echo '</form>';
	echo '<p>' . esc_html__( 'To check it works: open your site in a private window, then look at AdLedger → Settings → Tracking. New page views appear within a minute.', 'adledger' ) . '</p>';
	echo '</div>';
}

/**
 * "Settings" link on the Plugins screen.
 *
 * @param array $links Action links.
 * @return array
 */
function adledger_action_links( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=adledger' ) ) . '">' . esc_html__( 'Settings', 'adledger' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( ADLEDGER_FILE ), 'adledger_action_links' );

/**
 * Nudge admins until the plugin is configured.
 */
function adledger_admin_notice() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$screen = get_current_screen();
	if ( $screen && 'settings_page_adledger' === $screen->id ) {
		return;
	}
	$s = adledger_settings();
	if ( '' !== $s['url'] && '' !== $s['site_key'] ) {
		return;
	}
	printf(
		'<div class="notice notice-info"><p>%1$s <a href="%2$s">%3$s</a></p></div>',
		esc_html__( 'AdLedger is not tracking yet.', 'adledger' ),
		esc_url( admin_url( 'options-general.php?page=adledger' ) ),
		esc_html__( 'Add your AdLedger URL and site key.', 'adledger' )
	);
}
add_action( 'admin_notices', 'adledger_admin_notice' );
