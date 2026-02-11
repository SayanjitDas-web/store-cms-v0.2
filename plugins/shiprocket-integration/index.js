const express = require('express');
const path = require('path');
const axios = require('axios');

module.exports = {
    name: 'shiprocket-integration',
    version: '1.0.0',
    description: 'Shiprocket Integration for StoreCMS',

    init: async (app, HookSystem, MediaAPI, options) => {
        const { protect, adminMenuMiddleware } = options;

        console.log('Shiprocket Integration Plugin Initialized');

        const envManager = require('../../src/utils/envManager');
        envManager.registerEnvKey('SHIPROCKET_EMAIL');
        envManager.registerEnvKey('SHIPROCKET_PASSWORD');

        // Shiprocket API Config
        const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
        let authToken = null;
        let tokenExpiry = null;

        // --- Helper Functions ---

        const login = async () => {
            const settings = envManager.getEnv();
            const email = settings.SHIPROCKET_EMAIL;
            constpassword = settings.SHIPROCKET_PASSWORD;

            if (!email || !password) {
                console.error('Shiprocket: Missing email or password in settings.');
                return null;
            }

            try {
                const response = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, {
                    email: email,
                    password: password
                });

                authToken = response.data.token;
                // Shiprocket tokens last 10 days, but let's refresh if older than 24h just in case or on restart
                tokenExpiry = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
                return authToken;
            } catch (err) {
                console.error('Shiprocket Login Failed:', err.response?.data || err.message);
                return null;
            }
        }

        const getToken = async () => {
            if (authToken && tokenExpiry && new Date() < tokenExpiry) {
                return authToken;
            }
            return await login();
        }

        // --- Router ---
        const adminRouter = express.Router();
        if (protect) adminRouter.use(protect);
        if (adminMenuMiddleware) adminRouter.use(adminMenuMiddleware);

        // Settings Page

        adminRouter.get('/settings', (req, res) => {
            const settings = envManager.getEnv(true);
            res.render('shiprocket-settings', { settings });
        });

        adminRouter.post('/settings', async (req, res) => {
            try {
                const { SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD } = req.body;
                await envManager.writeEnv({ SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD });

                // Try logging in to verify
                const token = await login();
                let message = 'Settings saved.';
                if (token) {
                    message += ' Connection with Shiprocket successful!';
                } else {
                    message += ' Warning: Could not connect to Shiprocket. Check credentials.';
                }

                res.render('shiprocket-settings', {
                    settings: envManager.getEnv(true),
                    success: message,
                    error: null
                });
            } catch (err) {
                res.render('shiprocket-settings', {
                    settings: envManager.getEnv(true),
                    success: null,
                    error: err.message
                });
            }
        });

        app.use('/admin/shiprocket', adminRouter);

        // --- Views ---
        const viewsPath = path.join(__dirname, 'views');
        const existingViews = app.get('views');
        if (Array.isArray(existingViews)) {
            if (!existingViews.includes(viewsPath)) {
                app.set('views', [...existingViews, viewsPath]);
            }
        } else {
            app.set('views', [existingViews, viewsPath]);
        }

        // --- Hooks ---

        // Admin Sidebar
        HookSystem.addFilter('admin_sidebar_menu', (menu) => {
            menu.push({
                title: 'Shiprocket',
                link: '/admin/shiprocket/settings',
                icon: 'bi-truck'
            });
            return menu;
        });

        // Order Hook
        HookSystem.addAction('order_created', async (order) => {
            console.log('Shiprocket: Processing new order', order._id);
            const token = await getToken();
            if (!token) {
                console.error('Shiprocket: Cannot sync order. No token.');
                return;
            }

            // Map Order to Shiprocket Payload
            // Note: This is a basic mapping. Real-world needs robust address parsing.
            const payload = {
                order_id: order._id.toString(),
                order_date: new Date(order.createdAt).toISOString().split('T')[0] + ' ' + new Date(order.createdAt).toTimeString().split(' ')[0],
                pickup_location: "Primary", // User needs to configure this in Shiprocket dashboard
                billing_customer_name: order.customerInfo.firstName,
                billing_last_name: order.customerInfo.lastName,
                billing_address: order.customerInfo.address,
                billing_address_2: "",
                billing_city: order.customerInfo.city,
                billing_pincode: order.customerInfo.pincode,
                billing_state: order.customerInfo.state,
                billing_country: "India",
                billing_email: order.customerInfo.email,
                billing_phone: order.customerInfo.phone,
                shipping_is_billing: true,
                order_items: order.items.map(item => ({
                    name: item.name,
                    sku: item.productId.toString(), // Using ID as SKU
                    units: item.quantity,
                    selling_price: item.price,
                    discount: "",
                    tax: "",
                    hsn: ""
                })),
                payment_method: order.payment.method === 'cod' ? 'COD' : 'Prepaid',
                shipping_charges: 0,
                gift_wrap_charges: 0,
                transaction_charges: 0,
                total_discount: 0,
                sub_total: order.totalAmount,
                length: 10,
                breadth: 10,
                height: 10,
                weight: 0.5
            };

            // NOTE: StoreCMS currently lacks fields like city, state, pincode, phone.
            // I will use placeholders and log the attempt. This requires CMS update to be fully functional.

            try {
                const response = await axios.post(`${SHIPROCKET_BASE_URL}/orders/create/adhoc`, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                console.log('Shiprocket Sync Success:', response.data);

                // Update order note? We need a way to modify order. 
                // Since this is async action, we need to access Model.
                // But actions just get the object.
                // We'll trust console log for now or need to require Mongoose Model here.

            } catch (err) {
                console.error('Shiprocket Sync Failed:', err.response?.data || err.message);
            }
        });
    }
};
