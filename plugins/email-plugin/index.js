const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

module.exports = {
    init: async (app, HookSystem, MediaAPI, { protect, adminMenuMiddleware }, PluginManager) => {
        const envManager = require('../../src/utils/envManager');

        // 1. Register SMTP Environment Keys
        envManager.registerEnvKey('SMTP_HOST');
        envManager.registerEnvKey('SMTP_PORT');
        envManager.registerEnvKey('SMTP_USER');
        envManager.registerEnvKey('SMTP_PASS');
        envManager.registerEnvKey('SMTP_FROM');

        const adminRouter = express.Router();
        if (protect) adminRouter.use(protect);
        if (adminMenuMiddleware) adminRouter.use(adminMenuMiddleware);

        // Sidebar Hook
        HookSystem.addFilter('admin_sidebar_menu', (menu) => {
            menu.push({
                title: 'Email Marketing',
                link: '/admin/email-marketing',
                icon: 'bi-envelope-heart'
            });
            return menu;
        });

        // 2. Views Setup
        const viewsPath = path.join(__dirname, 'views');
        const existingViews = app.get('views');
        app.set('views', [viewsPath, ...(Array.isArray(existingViews) ? existingViews : [existingViews])]);

        // 3. Admin Routes
        adminRouter.get('/', async (req, res) => {
            try {
                const Order = mongoose.model('Order');
                const customers = await Order.aggregate([
                    { $group: { _id: "$customerInfo.email", firstName: { $first: "$customerInfo.firstName" }, lastName: { $first: "$customerInfo.lastName" } } }
                ]);

                const settings = envManager.getEnv(true); // Masked for UI
                res.render('compose', { customers, settings });
            } catch (err) {
                console.error('Email Plugin:', err);
                res.render('compose', { customers: [], settings: envManager.getEnv(true), error: 'Could not fetch customers. Ensure ecommerce-core is active.' });
            }
        });

        adminRouter.get('/settings', (req, res) => {
            const settings = envManager.getEnv(true);
            res.render('settings', { settings, success: null, error: null });
        });

        adminRouter.post('/settings', async (req, res) => {
            try {
                const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = req.body;
                await envManager.writeEnv({
                    SMTP_HOST,
                    SMTP_PORT,
                    SMTP_USER,
                    SMTP_PASS,
                    SMTP_FROM
                });
                res.render('settings', { settings: envManager.getEnv(true), success: 'SMTP Settings updated successfully!', error: null });
            } catch (err) {
                res.render('settings', { settings: req.body, error: err.message, success: null });
            }
        });

        adminRouter.post('/send', async (req, res) => {
            const { recipients, subject, message } = req.body;

            try {
                const env = envManager.getEnv(false); // Real credentials

                if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
                    throw new Error('SMTP is not configured.');
                }

                const transporter = nodemailer.createTransport({
                    host: env.SMTP_HOST,
                    port: parseInt(env.SMTP_PORT) || 587,
                    secure: env.SMTP_PORT === '465',
                    auth: {
                        user: env.SMTP_USER,
                        pass: env.SMTP_PASS
                    }
                });

                const mailOptions = {
                    from: env.SMTP_FROM || env.SMTP_USER,
                    to: Array.isArray(recipients) ? recipients.join(',') : recipients,
                    subject: subject,
                    html: message
                };

                await transporter.sendMail(mailOptions);

                // Return to compose with success
                const Order = mongoose.model('Order');
                const customers = await Order.aggregate([
                    { $group: { _id: "$customerInfo.email", firstName: { $first: "$customerInfo.firstName" }, lastName: { $first: "$customerInfo.lastName" } } }
                ]);
                res.render('compose', { customers, settings: envManager.getEnv(true), success: 'Emails sent successfully!' });

            } catch (err) {
                const Order = mongoose.model('Order');
                const customers = await Order.aggregate([
                    { $group: { _id: "$customerInfo.email", firstName: { $first: "$customerInfo.firstName" }, lastName: { $first: "$customerInfo.lastName" } } }
                ]);
                res.render('compose', { customers, settings: envManager.getEnv(true), error: err.message });
            }
        });

        app.use('/admin/email-marketing', adminRouter);
    }
};
