/*
 * Phase 13a: creates the PayPal catalog product and the two monthly subscription plans (USD, CAD) in the
 * configured PAYPAL_MODE (sandbox | live), then prints the ids for .env (PAYPAL_PRODUCT_ID,
 * PAYPAL_PLAN_ID_USD, PAYPAL_PLAN_ID_CAD). Each subscription overrides its plan's price, so the plan
 * price is only a placeholder. Makes real PayPal calls: only Mohit runs it, once per environment.
 *
 *   npm run billing:paypal-setup -- --confirm
 */
import config from '../configs/config';
import { paypalClient } from '../clients/paypalClient';
import { CURRENCIES } from '../billing/constants';

const main = async (): Promise<number> => {
	const client = paypalClient();
	if (!client.configured()) {
		process.stderr.write('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set.\n');
		return 2;
	}
	if (!process.argv.includes('--confirm')) {
		process.stderr.write(`This creates a product and 2 plans in PayPal ${client.mode}. Re-run with --confirm.\n`);
		return 2;
	}
	const product = config.paypal.productId ? { id: config.paypal.productId } : await client.createProduct({ name: 'MyPageSEO', description: 'MyPageSEO local SEO platform: monthly subscription per location' });
	const lines = [`PAYPAL_MODE=${client.mode}`, `PAYPAL_PRODUCT_ID=${product.id}${config.paypal.productId ? ' (existing)' : ''}`];
	for (const currency of CURRENCIES) {
		if (config.paypal.planIds[currency]) {
			lines.push(`PAYPAL_PLAN_ID_${currency}=${config.paypal.planIds[currency]} (existing)`);
			continue;
		}
		const plan = await client.createPlan({ product_id: product.id, name: `MyPageSEO monthly (${currency})`, currency, placeholder_price: 1 });
		lines.push(`PAYPAL_PLAN_ID_${currency}=${plan.id}`);
	}
	process.stdout.write(`${lines.join('\n')}\nPayPal calls made: ${client.callCount()}\n`);
	return 0;
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`billing:paypal-setup failed: ${err.message}\n`);
		process.exit(1);
	});
