const express = require('express');
const router = express.Router();
const {
    getPrinters,
    getCashPrinters,
    getCategories,
    getGeneralCategories,
    getMenuList,
    getPaymentMethods,
    getSaleTypes,
    getTags,
    getReasons,
    getDeleteCheckReasons,
    getReturnCheckReasons,
    getTableGroups,
    getTables,
    getWaitersList,
    waitersAuth,
    getProfile,
    getTerminalsList,
    getWithoutPaidMethod,
    getAllActiveOrders,
    getReviews,
    createReview,
    getMaxChecks,
    updateMaxChecks
} = require('../controllers/pos.controller');

// All routes are PUBLIC - No authentication required

// GET routes
router.get('/printers/:profileId', getPrinters);
router.get('/cash-printers/:profileId', getCashPrinters);
router.get('/categories/:profileId', getCategories);
router.get('/general-categories/:profileId', getGeneralCategories);
router.get('/menu/:profileId', getMenuList);
router.get('/payment-methods/:profileId', getPaymentMethods);
router.get('/sale-types/:profileId', getSaleTypes);
router.get('/tags/:profileId', getTags);
router.get('/reasons/:profileId/:type', getReasons);
router.get('/delete-check-reasons/:profileId', getDeleteCheckReasons);
router.get('/return-check-reasons/:profileId', getReturnCheckReasons);
router.get('/table-groups/:profileId', getTableGroups);
router.get('/tables/:profileId', getTables);
router.get('/waiters/:profileId', getWaitersList);
router.get('/reviews/:id', getReviews);
router.get('/max-checks/:profileId', getMaxChecks);

// POST routes
router.post('/waiters-auth', waitersAuth);
router.post('/profile', getProfile);
router.post('/terminals', getTerminalsList);
router.post('/without-paid-method', getWithoutPaidMethod);
router.post('/active-orders', getAllActiveOrders);
router.post('/reviews', createReview);
router.post('/max-checks', updateMaxChecks);

module.exports = router;
