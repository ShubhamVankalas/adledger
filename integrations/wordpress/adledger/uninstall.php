<?php
/**
 * Remove AdLedger settings when the plugin is deleted.
 * Order meta (_adledger_vid) is left on orders on purpose: it is part of the order record.
 *
 * @package AdLedger
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'adledger_settings' );

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids' ) ) as $adledger_site_id ) {
		switch_to_blog( $adledger_site_id );
		delete_option( 'adledger_settings' );
		restore_current_blog();
	}
}

if ( function_exists( 'as_unschedule_all_actions' ) ) {
	as_unschedule_all_actions( 'adledger_send_conversion' );
}
