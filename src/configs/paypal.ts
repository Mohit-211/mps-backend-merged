import paypal from "@paypal/checkout-server-sdk";

const environment =
	process.env.PAYPAL_MODE === "live"
		? new paypal.core.LiveEnvironment(
				process.env.PAYPAL_CLIENT_ID!,
				process.env.PAYPAL_CLIENT_SECRET!,
		  )
		: new paypal.core.SandboxEnvironment(
				process.env.PAYPAL_CLIENT_ID!,
				process.env.PAYPAL_CLIENT_SECRET!,
		  );

const client = new paypal.core.PayPalHttpClient(environment);

const BASE_URL =
	process.env.PAYPAL_MODE === "live"
		? "https://api-m.paypal.com"
		: "https://api-m.sandbox.paypal.com";

export { paypal, client, BASE_URL };