<?php
/**
 * Plugin Name:          AdLedger
 * Plugin URI:           https://github.com/ShubhamVankalas/adledger
 * Description:          Connects your site to your self-hosted AdLedger: installs the tracking pixel, captures form leads and sends WooCommerce orders and refunds, so you can see which ad made you money.
 * Version:              0.1.0
 * Requires at least:    6.0
 * Requires PHP:         7.4
 * Author:               AdLedger contributors
 * Author URI:           https://github.com/ShubhamVankalas/adledger
 * License:              AGPL-3.0-or-later
 * License URI:          https://www.gnu.org/licenses/agpl-3.0.html
 * Text Domain:          adledger
 * WC requires at least: 7.1
 * WC tested up to:      9.3
 *
 * @package AdLedger
 */

defined( 'ABSPATH' ) || exit;

define( 'ADLEDGER_VERSION', '0.1.0' );
define( 'ADLEDGER_OPTION', 'adledger_settings' );
define( 'ADLEDGER_FILE', __FILE__ );
define( 'ADLEDGER_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Saved settings merged with defaults.
 *
 * @return array{url:string,site_key:string,api_key:string,forms:bool,woo_server:bool,skip_admins:bool}
 */
function adledger_settings() {
	$defaults = array(
		'url'         => '',
		'site_key'    => '',
		'api_key'     => '',
		'forms'       => true,
		'woo_server'  => true,
		'skip_admins' => true,
	);
	$saved    = get_option( ADLEDGER_OPTION, array() );
	return array_merge( $defaults, is_array( $saved ) ? $saved : array() );
}

/**
 * Should the browser-side tracking run on this request?
 *
 * @return bool
 */
function adledger_tracking_enabled() {
	$s = adledger_settings();
	if ( '' === $s['url'] || '' === $s['site_key'] ) {
		return false;
	}
	if ( $s['skip_admins'] && is_user_logged_in() && current_user_can( 'manage_options' ) ) {
		return false;
	}
	/**
	 * Filter whether AdLedger tracking is printed on this page.
	 *
	 * @param bool $enabled Whether to track.
	 */
	return (bool) apply_filters( 'adledger_tracking_enabled', true );
}

// Declare WooCommerce HPOS + checkout blocks compatibility.
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', ADLEDGER_FILE, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', ADLEDGER_FILE, true );
		}
	}
);

/**
 * Print the queue stub + pixel as early as possible in <head>.
 */
function adledger_print_pixel() {
	if ( is_admin() || ! adledger_tracking_enabled() ) {
		return;
	}
	$s    = adledger_settings();
	$stub = 'window.adledger=window.adledger||{q:[]};["identify","lead","track","consent"].forEach(function(m){adledger[m]=adledger[m]||function(){adledger.q.push([m].concat([].slice.call(arguments)))}});';
	wp_print_inline_script_tag( $stub, array( 'id' => 'adledger-stub' ) );
	wp_print_script_tag(
		array(
			'id'        => 'adledger-pixel',
			'src'       => esc_url_raw( $s['url'] . '/p/al.js' ),
			'async'     => true,
			'data-site' => $s['site_key'],
		)
	);
}
add_action( 'wp_head', 'adledger_print_pixel', 1 );

/**
 * Front-end helper script: form lead capture and the WooCommerce visitor-id field.
 */
function adledger_enqueue_scripts() {
	if ( ! adledger_tracking_enabled() ) {
		return;
	}
	$s = adledger_settings();
	wp_enqueue_script( 'adledger-wp', plugins_url( 'assets/adledger-wp.js', ADLEDGER_FILE ), array(), ADLEDGER_VERSION, true );
	wp_add_inline_script(
		'adledger-wp',
		'window.adledgerWP=' . wp_json_encode( array( 'forms' => (bool) $s['forms'] ) ) . ';',
		'before'
	);
}
add_action( 'wp_enqueue_scripts', 'adledger_enqueue_scripts' );

require_once ADLEDGER_DIR . 'includes/settings.php';
require_once ADLEDGER_DIR . 'includes/woocommerce.php';
