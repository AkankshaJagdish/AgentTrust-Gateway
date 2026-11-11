import "server-only";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

/**
 * Limited PayPal Agent Toolkit configuration for agent-side order visibility.
 * Payment authorization/capture/refund tools are deliberately not enabled;
 * merchant-controlled REST routes own every state-changing operation.
 */
export function createPayPalAgentToolkit() {
  const clientId=process.env.PAYPAL_CLIENT_ID;
  const clientSecret=process.env.PAYPAL_CLIENT_SECRET;
  if(!clientId||!clientSecret)throw new Error("PayPal sandbox credentials are not configured.");
  return new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration:{
      context:{sandbox:process.env.PAYPAL_ENVIRONMENT!=="LIVE"},
      actions:{
        orders:{get:true},
      },
    },
  });
}
