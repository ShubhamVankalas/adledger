import { CRM_CONNECTORS } from "../crm/index";
import type { RevenueConnector } from "../types";
import { lemonSqueezyConnector } from "./lemonsqueezy";
import { paddleConnector } from "./paddle";
import { paypalConnector } from "./paypal";
import { razorpayConnector } from "./razorpay";
import { shopifyConnector } from "./shopify";
import { woocommerceConnector } from "./woocommerce";

/** Revenue connectors beyond Stripe (one file per source in this folder). */
export const REVENUE_CONNECTORS: RevenueConnector[] = [
  shopifyConnector,
  woocommerceConnector,
  paddleConnector,
  lemonSqueezyConnector,
  razorpayConnector,
  paypalConnector,
  ...CRM_CONNECTORS,
];
