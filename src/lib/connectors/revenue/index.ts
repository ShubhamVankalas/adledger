import type { RevenueConnector } from "../types";
import { chargebeeConnector } from "./chargebee";
import { gumroadConnector } from "./gumroad";
import { lemonSqueezyConnector } from "./lemonsqueezy";
import { paddleConnector } from "./paddle";
import { paypalConnector } from "./paypal";
import { razorpayConnector } from "./razorpay";
import { recurlyConnector } from "./recurly";
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
  chargebeeConnector,
  recurlyConnector,
  gumroadConnector,
];
