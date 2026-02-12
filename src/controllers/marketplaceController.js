const PluginManager = require('../core/PluginManager');

// @desc    Get marketplace plugins
// @route   GET /admin/plugins/marketplace
// @access  Private/Admin
exports.getMarketplace = async (req, res) => {
    try {
        const marketplacePlugins = await PluginManager.fetchMarketplacePlugins();
        const installedPlugins = PluginManager.plugins;
        const licenseKey = PluginManager.licenseKey;
        const isValidLicense = PluginManager.isValidLicense();

        res.render('admin/plugins/index', {
            plugins: installedPlugins,
            marketplacePlugins,
            licenseKey,
            isValidLicense,
            view: 'marketplace',
            error: null,
            success: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// @desc    Update license key
// @route   POST /admin/plugins/license
// @access  Private/Admin
exports.updateLicense = async (req, res) => {
    const { licenseKey } = req.body;
    try {
        const isValid = PluginManager.setLicenseKey(licenseKey);

        if (isValid) {
            req.session.success = 'Pro License activated successfully!';
        } else {
            req.session.error = 'Invalid License Key. Please check your credentials.';
        }

        res.redirect('/admin/plugins');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/plugins');
    }
};
