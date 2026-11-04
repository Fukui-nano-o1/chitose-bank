import { supabase } from "./supabase";
import { createOperatorGreetingDelivery } from "./operatorGreetingDelivery";

// Two independent activation gates: this build flag AND the private server
// configuration. Both are disabled by default; no production text is supplied.
const delivery = createOperatorGreetingDelivery({
  client: supabase,
  enabled: import.meta.env.VITE_OPERATOR_GREETINGS_ENABLED === "true",
});

export const recordOperatorLogin = session => delivery.recordLogin(session);
export const retryOperatorGreetings = (userId, options) => delivery.retry(userId, options);
