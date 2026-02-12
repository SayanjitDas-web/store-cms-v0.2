const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const adminMenuMiddleware = require('../middlewares/adminMenuMiddleware');
const PluginManager = require('../core/PluginManager');

const { getPages, createPageForm, createPage, editPageForm, updatePage, deletePage } = require('../controllers/pageController');

router.get('/login', (req, res) => {
    res.render('admin/login');
});

router.use(protect); // Protect all routes BELOW this
router.use(adminMenuMiddleware); // Generate menu for all routes BELOW this

router.get('/dashboard', (req, res) => {
    res.render('admin/dashboard', { user: req.user });
});

const { getPlugins, togglePlugin, uploadPlugin, deletePlugin } = require('../controllers/pluginController');
const { getMarketplace, updateLicense } = require('../controllers/marketplaceController');

// Page Routes
// Cloud-Ready Upload Middleware
const { upload } = require('../utils/mediaManager');

router.get('/pages', getPages);
router.get('/pages/create', createPageForm);
router.post('/pages', upload, createPage);
router.get('/pages/edit/:id', editPageForm);
router.post('/pages/edit/:id', upload, updatePage);
router.post('/pages/delete/:id', deletePage);

// Media Routes
const mediaController = require('../controllers/mediaController');
// const { upload } = require('../utils/mediaManager'); // Already imported above

router.get('/media', mediaController.index);
router.get('/media/api/list', mediaController.apiList);
router.post('/media/api/upload', upload, mediaController.apiUpload);
router.post('/media/api/delete', mediaController.apiDelete);

// Plugin Routes
router.get('/plugins', (req, res, next) => {
    // Inject default view state
    res.locals.view = 'installed';
    res.locals.licenseKey = PluginManager.licenseKey;
    res.locals.isValidLicense = PluginManager.isValidLicense();
    getPlugins(req, res, next);
});
router.get('/plugins/marketplace', getMarketplace);
router.post('/plugins/license', updateLicense);
router.post('/plugins/upload', uploadPlugin);
router.post('/plugins/toggle/:name', togglePlugin);
router.post('/plugins/delete/:name', deletePlugin);

router.get('/', (req, res) => {
    res.redirect('/admin/dashboard');
});

module.exports = router;
