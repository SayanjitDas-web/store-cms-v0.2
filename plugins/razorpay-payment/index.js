const express = require('express');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

module.exports = {
    name: 'razorpay-payment',
    version: '1.0.0',
    description: 'Razorpay Payment Integration',

    init: async (app, HookSystem, MediaAPI, options) => {
        const { protect, adminMenuMiddleware } = options;
        console.log('Razorpay Payment Plugin Initialized');

        const envManager = require('../../src/utils/envManager');
        envManager.registerEnvKey('RAZORPAY_KEY_ID');
        envManager.registerEnvKey('RAZORPAY_KEY_SECRET');

        // --- Helper: Get Razorpay Instance ---
        const getRazorpay = () => {
            const settings = envManager.getEnv();
            if (!settings.RAZORPAY_KEY_ID || !settings.RAZORPAY_KEY_SECRET) {
                return null;
            }
            return new Razorpay({
                key_id: settings.RAZORPAY_KEY_ID,
                key_secret: settings.RAZORPAY_KEY_SECRET
            });
        };

        // --- Router ---
        const adminRouter = express.Router();
        if (protect) adminRouter.use(protect);
        if (adminMenuMiddleware) adminRouter.use(adminMenuMiddleware);

        // Settings Page
        adminRouter.get('/settings', (req, res) => {
            const settings = envManager.getEnv(true);
            res.render('razorpay-settings', { settings });
        });

        adminRouter.post('/settings', async (req, res) => {
            try {
                const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = req.body;
                await envManager.writeEnv({ RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET });

                res.render('razorpay-settings', {
                    settings: envManager.getEnv(true),
                    success: 'Settings saved successfully.',
                    error: null
                });
            } catch (err) {
                res.render('razorpay-settings', {
                    settings: envManager.getEnv(true),
                    success: null,
                    error: err.message
                });
            }
        });

        app.use('/admin/razorpay', adminRouter);

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

        // 1. Admin Sidebar
        HookSystem.addFilter('admin_sidebar_menu', (menu) => {
            menu.push({
                title: 'Razorpay',
                link: '/admin/razorpay/settings',
                icon: 'bi-credit-card'
            });
            return menu;
        });

        // 2. Checkout Payment Method option
        HookSystem.addFilter('checkout_payment_methods_html', (html) => {
            const keyId = envManager.getEnv().RAZORPAY_KEY_ID;
            if (!keyId) return html;

            return html + `
            <div class="flex items-center mb-6">
                <input id="razorpay" name="paymentMethod" type="radio"
                    class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                    value="razorpay">
                <label for="razorpay" class="ml-2 block text-sm text-gray-900">
                    Pay with Razorpay (Credit/Debit Card, UPI, Netbanking)
                </label>
            </div>`;
        });


        // 3. Checkout Scripts
        HookSystem.addFilter('checkout_scripts_html', (html) => {
            const keyId = envManager.getEnv().RAZORPAY_KEY_ID;
            if (!keyId) return html;

            return html + `
            <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
            <script>
                document.getElementById('checkoutForm').addEventListener('submit', async function(e) {
                    const paymentMethodInput = document.querySelector('input[name="paymentMethod"]:checked');
                    if (!paymentMethodInput) return; // Let default validation handle it
                    
                    const paymentMethod = paymentMethodInput.value;
                    
                    if (paymentMethod === 'razorpay') {
                        e.preventDefault();
                        const formData = new FormData(this);
                        const data = Object.fromEntries(formData.entries());
                        const submitBtn = this.querySelector('button[type="submit"]');
                        const originalText = submitBtn.innerText;
                        
                        try {
                            submitBtn.disabled = true;
                            submitBtn.innerText = 'Processing...';

                            // 1. Create Order
                            const amountElem = document.querySelector('.text-2xl.font-bold.text-indigo-700') || document.querySelector('.text-xl.font-bold.text-indigo-700'); 
                            // Try to find amount element. 
                            // fallback if frontend structure changes?
                            // Better: The server source of truth is session. 
                            // We trigger create-order without amount param, server uses session.
                            
                            const orderRes = await fetch('/api/razorpay/create-order', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            
                            if (!orderRes.ok) {
                                const err = await orderRes.json();
                                throw new Error(err.error || 'Failed to create order');
                            }
                            
                            const order = await orderRes.json();
                            
                            const options = {
                                "key": "${keyId}",
                                "amount": order.amount,
                                "currency": "INR",
                                "name": "Store CMS",
                                "description": "Order Payment",
                                "order_id": order.id,
                                "handler": function (response){
                                    // Verify and Place Order
                                    verifyAndPlaceOrder(response, data);
                                },
                                "prefill": {
                                    "name": (data.firstName || '') + ' ' + (data.lastName || ''),
                                    "email": data.email,
                                    "contact": data.phone
                                },
                                "theme": {
                                    "color": "#4F46E5"
                                }
                            };
                            
                            const rzp1 = new Razorpay(options);
                            rzp1.on('payment.failed', function (response){
                                alert(response.error.description);
                                submitBtn.disabled = false;
                                submitBtn.innerText = originalText;
                            });
                            rzp1.open();

                        } catch (err) {
                            console.error(err);
                            alert('Payment Initialization Failed: ' + err.message);
                            submitBtn.disabled = false;
                            submitBtn.innerText = originalText;
                        }
                    }
                });

                async function verifyAndPlaceOrder(razorpayResponse, customerData) {
                    const form = document.createElement('form');
                    form.method = 'POST';
                    form.action = '/api/razorpay/verify';

                    const allData = { ...customerData, ...razorpayResponse };

                    for (const key in allData) {
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = key;
                        input.value = allData[key];
                        form.appendChild(input);
                    }
                    
                    document.body.appendChild(form);
                    form.submit();
                }
            </script>`;
        });


        const router = express.Router();

        // Create Order
        router.post('/api/razorpay/create-order', async (req, res) => {
            try {
                const instance = getRazorpay();
                if (!instance) return res.status(500).json({ error: 'Razorpay not configured' });

                // SECURITY: Calculate amount from Server Session
                if (!req.session.cart || !req.session.cart.total) {
                    return res.status(400).json({ error: 'Cart is empty or invalid' });
                }

                const amount = req.session.cart.total;
                // Convert to paise (INR * 100)
                // If your store is in USD, you might need conversion rate. 
                // Assuming Store is INR based for Razorpay context.

                const options = {
                    amount: Math.round(amount * 100),
                    currency: "INR",
                    receipt: "order_rcptid_" + Date.now()
                };
                const order = await instance.orders.create(options);
                res.json(order);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: error.message });
            }
        });

        // Verify Payment & Create Order
        router.post('/api/razorpay/verify', async (req, res) => {
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature, ...customerData } = req.body;

            try {
                const settings = envManager.getEnv();
                const body = razorpay_order_id + "|" + razorpay_payment_id;
                const expectedSignature = crypto.createHmac('sha256', settings.RAZORPAY_KEY_SECRET)
                    .update(body.toString())
                    .digest('hex');

                if (expectedSignature === razorpay_signature) {
                    // Payment Successful - Create Order
                    const Order = mongoose.model('Order');
                    const Product = mongoose.model('Product');

                    const cartItems = req.session.cart.items;

                    // User
                    const user = req.user._id;

                    // Deduct stock
                    for (const item of cartItems) {
                        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
                    }

                    const { firstName, lastName, email, phone, address, city, state, pincode } = customerData;

                    const order = await Order.create({
                        user: user,
                        customerInfo: { firstName, lastName, email, phone, address, city, state, pincode },
                        items: cartItems.map(i => ({
                            productId: i.productId,
                            name: i.name,
                            quantity: i.quantity,
                            price: i.price
                        })),
                        totalAmount: req.session.cart.total,
                        payment: {
                            method: 'razorpay',
                            transactionId: razorpay_payment_id,
                            status: 'completed'
                        },
                        status: 'pending' // Shiprocket will pick this up
                    });

                    // Fire Hooks
                    HookSystem.doAction('order_created', order);

                    // Clear Cart
                    req.session.cart = { items: [], total: 0 };

                    res.redirect('/shop/order/success/' + order._id);

                } else {
                    res.status(400).send('Invalid Signature');
                }
            } catch (err) {
                console.error(err);
                res.status(500).send('Order Creation Failed: ' + err.message);
            }
        });

        app.use(router);
    }
};
