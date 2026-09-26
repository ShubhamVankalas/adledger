import { CRM_CONNECTORS } from "../crm/index";
import type { RevenueConnector } from "../types";
import { cashfreeConnector } from "./cashfree";
import { chargebeeConnector } from "./chargebee";
import { gumroadConnector } from "./gumroad";
import { instamojoConnector } from "./instamojo";
import { lemonSqueezyConnector } from "./lemonsqueezy";
import { paddleConnector } from "./paddle";
import { paypalConnector } from "./paypal";
import { phonepeConnector } from "./phonepe";
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
  cashfreeConnector,
  instamojoConnector,
  phonepeConnector,
  ...CRM_CONNECTORS,
];
