const { pool } = require('../config/database');
const crypto = require('crypto');

// Generate UUID without external package
const generateUUID = () => {
    return crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
};

/**
 * Orders Service - handles all order operations
 */

/**
 * @desc    Create new order/check
 * @route   POST /api/orders
 * @body    { profileId, tableId, hallId, waiterId, terminalId, saleType, items }
 */
const createOrder = async (req, res) => {
    try {
        const { profileId, tableId, hallId, waiterId, terminalId, saleType, items, note } = req.body;

        if (!profileId) {
            return res.json({ status: 'error', message: 'profileId required' });
        }

        const uuid = generateUUID();
        const localId = Date.now();

        // Create order
        const [result] = await pool.execute(`
            INSERT INTO orders (uuid, local_id, profile_id, table_id, hall_id, waiter_id, terminal_id, sale_type, status, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())
        `, [uuid, localId, profileId, tableId || 0, hallId || 0, waiterId || 0, terminalId || '', saleType || 0, note || '']);

        const orderId = result.insertId;

        // Add order items if provided
        if (items && items.length > 0) {
            for (const item of items) {
                await pool.execute(`
                    INSERT INTO orders_items (order_id, product_id, product_name, price, count, discount, waiter_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                `, [orderId, item.productId, item.productName, item.price, item.count || 1, item.discount || 0, waiterId || 0]);
            }
        }

        res.json({
            status: 'success',
            orderId,
            uuid,
            localId
        });
    } catch (error) {
        console.error('CreateOrder error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get order info by ID or UUID
 * @route   POST /api/orders/info
 * @body    { orderId } or { uuid }
 */
const getOrderInfo = async (req, res) => {
    try {
        const { orderId, uuid, profileId } = req.body;

        let query = `
            SELECT o.*, h.name as hall_name, t.name as table_name, w.name as waiter_name
            FROM orders o
            LEFT JOIN table_groups h ON o.hall_id = h.id
            LEFT JOIN tables t ON o.table_id = t.id
            LEFT JOIN waiters w ON o.waiter_id = w.id
            WHERE o.profile_id = ?
        `;
        const params = [profileId];

        if (orderId) {
            query += ' AND o.id = ?';
            params.push(orderId);
        } else if (uuid) {
            query += ' AND o.uuid = ?';
            params.push(uuid);
        }

        const [orders] = await pool.execute(query, params);

        if (orders.length === 0) {
            return res.json({ status: 'error', message: 'Order not found' });
        }

        // Get order items
        const [items] = await pool.execute(
            'SELECT * FROM orders_items WHERE order_id = ?',
            [orders[0].id]
        );

        res.json({
            status: 'success',
            order: orders[0],
            items
        });
    } catch (error) {
        console.error('GetOrderInfo error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get all active orders
 * @route   POST /api/orders/active
 * @body    { profileId }
 */
const getActiveOrders = async (req, res) => {
    try {
        const { profileId } = req.body;

        if (!profileId) {
            return res.json({ status: 'error', message: 'profileId required' });
        }

        const [orders] = await pool.execute(`
            SELECT o.*, h.name as hall, t.name as table_name, w.name as waiter_name
            FROM orders o
            LEFT JOIN table_groups h ON o.hall_id = h.id
            LEFT JOIN tables t ON o.table_id = t.id
            LEFT JOIN waiters w ON o.waiter_id = w.id
            WHERE o.status = 1 AND o.profile_id = ?
            ORDER BY o.created_at DESC
        `, [profileId]);

        res.json({ status: 'success', data: orders });
    } catch (error) {
        console.error('GetActiveOrders error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get all orders (with filters)
 * @route   POST /api/orders/all
 * @body    { profileId, status, startDate, endDate, waiterId }
 */
const getAllOrders = async (req, res) => {
    try {
        const { profileId, status, startDate, endDate, waiterId, limit = 100 } = req.body;

        if (!profileId) {
            return res.json({ status: 'error', message: 'profileId required' });
        }

        let query = `
            SELECT o.*, h.name as hall, t.name as table_name, w.name as waiter_name
            FROM orders o
            LEFT JOIN table_groups h ON o.hall_id = h.id
            LEFT JOIN tables t ON o.table_id = t.id
            LEFT JOIN waiters w ON o.waiter_id = w.id
            WHERE o.profile_id = ?
        `;
        const params = [profileId];

        if (status !== undefined) {
            query += ' AND o.status = ?';
            params.push(status);
        }
        if (waiterId) {
            query += ' AND o.waiter_id = ?';
            params.push(waiterId);
        }
        if (startDate) {
            query += ' AND o.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND o.created_at <= ?';
            params.push(endDate);
        }

        query += ` ORDER BY o.created_at DESC LIMIT ${parseInt(limit)}`;

        const [orders] = await pool.execute(query, params);
        res.json({ status: 'success', data: orders });
    } catch (error) {
        console.error('GetAllOrders error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Update order
 * @route   POST /api/orders/update
 * @body    { orderId, items, note, discount, etc. }
 */
const updateOrder = async (req, res) => {
    try {
        const { orderId, items, note, discount, serviceFee } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        // Update order if fields provided
        if (note !== undefined || discount !== undefined || serviceFee !== undefined) {
            let updateQuery = 'UPDATE orders SET ';
            const updateParams = [];
            const updates = [];

            if (note !== undefined) {
                updates.push('note = ?');
                updateParams.push(note);
            }
            if (discount !== undefined) {
                updates.push('discount = ?');
                updateParams.push(discount);
            }
            if (serviceFee !== undefined) {
                updates.push('service_fee = ?');
                updateParams.push(serviceFee);
            }

            updateQuery += updates.join(', ') + ' WHERE id = ?';
            updateParams.push(orderId);

            await pool.execute(updateQuery, updateParams);
        }

        // Add new items if provided
        if (items && items.length > 0) {
            for (const item of items) {
                await pool.execute(`
                    INSERT INTO orders_items (order_id, product_id, product_name, price, count, discount, waiter_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                `, [orderId, item.productId, item.productName, item.price, item.count || 1, item.discount || 0, item.waiterId || 0]);
            }
        }

        res.json({ status: 'success', message: 'Order updated' });
    } catch (error) {
        console.error('UpdateOrder error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Delete/Cancel order
 * @route   POST /api/orders/delete
 * @body    { orderId, reason, waiterId }
 */
const deleteOrder = async (req, res) => {
    try {
        const { orderId, reason, waiterId } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        // Soft delete - set status to deleted (e.g., status = 3)
        await pool.execute(
            'UPDATE orders SET status = 3, delete_reason = ?, deleted_by = ?, deleted_at = NOW() WHERE id = ?',
            [reason || '', waiterId || 0, orderId]
        );

        res.json({ status: 'success', message: 'Order deleted' });
    } catch (error) {
        console.error('DeleteOrder error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Pay/Close order
 * @route   POST /api/orders/pay
 * @body    { orderId, paymentMethodId, paidAmount, cashReceived, change }
 */
const payOrder = async (req, res) => {
    try {
        const { orderId, paymentMethodId, paidAmount, cashReceived, change, waiterId } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        // Update order status to paid (status = 2)
        await pool.execute(`
            UPDATE orders 
            SET status = 2, payment_method_id = ?, paid_amount = ?, cash_received = ?, change_amount = ?, closed_by = ?, closed_at = NOW()
            WHERE id = ?
        `, [paymentMethodId || 0, paidAmount || 0, cashReceived || 0, change || 0, waiterId || 0, orderId]);

        res.json({ status: 'success', message: 'Order paid' });
    } catch (error) {
        console.error('PayOrder error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Update table for order
 * @route   POST /api/orders/update-table
 * @body    { orderId, tableId, hallId }
 */
const updateTable = async (req, res) => {
    try {
        const { orderId, tableId, hallId } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        await pool.execute(
            'UPDATE orders SET table_id = ?, hall_id = ? WHERE id = ?',
            [tableId, hallId, orderId]
        );

        res.json({ status: 'success', message: 'Table updated' });
    } catch (error) {
        console.error('UpdateTable error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Update waiter for order
 * @route   POST /api/orders/update-waiter
 * @body    { orderId, waiterId }
 */
const updateWaiter = async (req, res) => {
    try {
        const { orderId, waiterId } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        await pool.execute(
            'UPDATE orders SET waiter_id = ? WHERE id = ?',
            [waiterId, orderId]
        );

        res.json({ status: 'success', message: 'Waiter updated' });
    } catch (error) {
        console.error('UpdateWaiter error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Update sale type for order
 * @route   POST /api/orders/update-sale-type
 * @body    { orderId, saleType }
 */
const updateSaleType = async (req, res) => {
    try {
        const { orderId, saleType } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        await pool.execute(
            'UPDATE orders SET sale_type = ? WHERE id = ?',
            [saleType, orderId]
        );

        res.json({ status: 'success', message: 'Sale type updated' });
    } catch (error) {
        console.error('UpdateSaleType error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Reverse/Reopen order
 * @route   POST /api/orders/reverse
 * @body    { orderId }
 */
const reverseOrder = async (req, res) => {
    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        await pool.execute(
            'UPDATE orders SET status = 1 WHERE id = ?',
            [orderId]
        );

        res.json({ status: 'success', message: 'Order reversed' });
    } catch (error) {
        console.error('ReverseOrder error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Split order items to new order
 * @route   POST /api/orders/split
 * @body    { orderId, itemIds, newTableId, newHallId }
 */
const splitOrder = async (req, res) => {
    try {
        const { orderId, itemIds, newTableId, newHallId, profileId, waiterId } = req.body;

        if (!orderId || !itemIds || itemIds.length === 0) {
            return res.json({ status: 'error', message: 'orderId and itemIds required' });
        }

        // Get original order
        const [originalOrder] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (originalOrder.length === 0) {
            return res.json({ status: 'error', message: 'Order not found' });
        }

        // Create new order
        const uuid = generateUUID();
        const localId = Date.now();

        const [newOrderResult] = await pool.execute(`
            INSERT INTO orders (uuid, local_id, profile_id, table_id, hall_id, waiter_id, terminal_id, sale_type, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
        `, [uuid, localId, profileId || originalOrder[0].profile_id, newTableId || originalOrder[0].table_id, newHallId || originalOrder[0].hall_id, waiterId || originalOrder[0].waiter_id, originalOrder[0].terminal_id, originalOrder[0].sale_type]);

        const newOrderId = newOrderResult.insertId;

        // Move items to new order
        const placeholders = itemIds.map(() => '?').join(',');
        await pool.execute(
            `UPDATE orders_items SET order_id = ? WHERE id IN (${placeholders})`,
            [newOrderId, ...itemIds]
        );

        res.json({
            status: 'success',
            message: 'Order split successfully',
            newOrderId,
            uuid
        });
    } catch (error) {
        console.error('SplitOrder error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Merge orders
 * @route   POST /api/orders/merge
 * @body    { sourceOrderId, targetOrderId }
 */
const mergeOrders = async (req, res) => {
    try {
        const { sourceOrderId, targetOrderId } = req.body;

        if (!sourceOrderId || !targetOrderId) {
            return res.json({ status: 'error', message: 'sourceOrderId and targetOrderId required' });
        }

        // Move all items from source to target
        await pool.execute(
            'UPDATE orders_items SET order_id = ? WHERE order_id = ?',
            [targetOrderId, sourceOrderId]
        );

        // Delete/close source order
        await pool.execute(
            'UPDATE orders SET status = 4 WHERE id = ?',
            [sourceOrderId]
        );

        res.json({ status: 'success', message: 'Orders merged successfully' });
    } catch (error) {
        console.error('MergeOrders error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Search orders
 * @route   POST /api/orders/search
 * @body    { profileId, query, searchBy }
 */
const searchOrders = async (req, res) => {
    try {
        const { profileId, query, searchBy = 'id' } = req.body;

        if (!profileId || !query) {
            return res.json({ status: 'error', message: 'profileId and query required' });
        }

        let sqlQuery = `
            SELECT o.*, h.name as hall, t.name as table_name, w.name as waiter_name
            FROM orders o
            LEFT JOIN table_groups h ON o.hall_id = h.id
            LEFT JOIN tables t ON o.table_id = t.id
            LEFT JOIN waiters w ON o.waiter_id = w.id
            WHERE o.profile_id = ?
        `;
        const params = [profileId];

        switch (searchBy) {
            case 'id':
                sqlQuery += ' AND o.id = ?';
                params.push(query);
                break;
            case 'uuid':
                sqlQuery += ' AND o.uuid = ?';
                params.push(query);
                break;
            case 'local_id':
                sqlQuery += ' AND o.local_id = ?';
                params.push(query);
                break;
            default:
                sqlQuery += ' AND o.id = ?';
                params.push(query);
        }

        const [orders] = await pool.execute(sqlQuery, params);
        res.json({ status: 'success', data: orders });
    } catch (error) {
        console.error('SearchOrders error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Update customer info
 * @route   POST /api/orders/update-customer
 * @body    { orderId, customerName, customerPhone }
 */
const updateCustomer = async (req, res) => {
    try {
        const { orderId, customerName, customerPhone } = req.body;

        if (!orderId) {
            return res.json({ status: 'error', message: 'orderId required' });
        }

        await pool.execute(
            'UPDATE orders SET customer_name = ?, customer_phone = ? WHERE id = ?',
            [customerName || '', customerPhone || '', orderId]
        );

        res.json({ status: 'success', message: 'Customer updated' });
    } catch (error) {
        console.error('UpdateCustomer error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Delete order item
 * @route   POST /api/orders/delete-item
 * @body    { itemId, reason, waiterId }
 */
const deleteOrderItem = async (req, res) => {
    try {
        const { itemId, reason, waiterId } = req.body;

        if (!itemId) {
            return res.json({ status: 'error', message: 'itemId required' });
        }

        // Soft delete or hard delete based on your preference
        await pool.execute(
            'UPDATE orders_items SET is_deleted = 1, delete_reason = ?, deleted_by = ?, deleted_at = NOW() WHERE id = ?',
            [reason || '', waiterId || 0, itemId]
        );

        res.json({ status: 'success', message: 'Item deleted' });
    } catch (error) {
        console.error('DeleteOrderItem error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

module.exports = {
    createOrder,
    getOrderInfo,
    getActiveOrders,
    getAllOrders,
    updateOrder,
    deleteOrder,
    payOrder,
    updateTable,
    updateWaiter,
    updateSaleType,
    reverseOrder,
    splitOrder,
    mergeOrders,
    searchOrders,
    updateCustomer,
    deleteOrderItem
};
