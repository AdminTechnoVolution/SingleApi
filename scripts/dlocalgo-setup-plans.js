/**
 * Creates the three Single Premium plans in dLocal Go and prints the env values.
 *
 *   DLOCALGO_API_KEY=... DLOCALGO_SECRET_KEY=... \
 *   DLOCALGO_API_URL=https://api-sbx.dlocalgo.com \
 *   DLOCALGO_PWA_URL=https://app.example.com \
 *   DLOCALGO_NOTIFICATION_URL=https://api.example.com/api/subscription/dlocalgo/webhook \
 *   DLOCALGO_CURRENCY=USD DLOCALGO_PRICE_WEEKLY=4.99 DLOCALGO_PRICE_MONTHLY=14.99 DLOCALGO_PRICE_QUARTERLY=34.99 \
 *   node scripts/dlocalgo-setup-plans.js
 *
 * Optional: DLOCALGO_COUNTRY (ISO alpha-2). Without it the buyer picks the country
 * at checkout, and dLocal Go then requires the currency to be USD.
 * Run once per environment (sandbox and production have separate keys and plans).
 */
require('dotenv').config();
const DlocalGo = require('../src/client/dlocalgo.client');

const required = (name) => {
    const value = process.env[name];
    if (!value) { console.error(`Missing ${name}`); process.exit(1); }
    return value;
};

const main = async () => {
    const pwaUrl = required('DLOCALGO_PWA_URL').replace(/\/+$/, '');
    const notificationUrl = required('DLOCALGO_NOTIFICATION_URL');
    const currency = (process.env.DLOCALGO_CURRENCY || 'USD').toUpperCase();
    const country = process.env.DLOCALGO_COUNTRY || undefined;
    if (!country && currency !== 'USD') { console.error('Without DLOCALGO_COUNTRY the currency must be USD'); process.exit(1); }

    const plans = [
        { key: 'WEEKLY', name: 'Single Premium semanal', frequency_type: 'WEEKLY', frequency_value: 1, amount: Number(required('DLOCALGO_PRICE_WEEKLY')) },
        { key: 'MONTHLY', name: 'Single Premium mensual', frequency_type: 'MONTHLY', frequency_value: 1, amount: Number(required('DLOCALGO_PRICE_MONTHLY')) },
        { key: 'QUARTERLY', name: 'Single Premium trimestral', frequency_type: 'MONTHLY', frequency_value: 3, amount: Number(required('DLOCALGO_PRICE_QUARTERLY')) }
    ];

    const lines = [];
    for (const plan of plans) {
        const created = await DlocalGo.createPlan({
            name: plan.name,
            description: 'Single Premium',
            currency,
            ...(country && { country }),
            amount: plan.amount,
            frequency_type: plan.frequency_type,
            frequency_value: plan.frequency_value,
            notification_url: notificationUrl,
            // dLocal Go appends ?external_id=... to success_url; the PWA confirms it.
            success_url: `${pwaUrl}/`,
            back_url: `${pwaUrl}/`,
            error_url: `${pwaUrl}/`
        });
        console.log(`${plan.name}: id=${created.id} subscribe_url=${created.subscribe_url}`);
        lines.push(`DLOCALGO_PLAN_${plan.key}_ID=${created.id}`);
    }
    console.log('\nAdd to SingleApi env:\n' + lines.join('\n'));
};

main().catch(err => { console.error(err.details || err); process.exit(1); });
