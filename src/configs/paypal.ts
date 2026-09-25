const BASE_URL =
	process.env.PAYPAL_MODE === "live"
		? "https://api-m.paypal.com"
		: "https://api-m.sandbox.paypal.com";

export { BASE_URL };
