/**
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 * Class Name      : OrderBuilderController
 * Author          : Ajinkya Thawali
 * Created Date    : Nov 24, 2026
 * Last Modified By: Ajinkya Thawali
 * Last Modified On: Nov 24, 2026
 * Description     : This class retrieves products, manages order line items,
 *                  and sends order details to an external API.
 *
 * Change History  :
 *  Date            │      Author            │   Change
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 *  Nov 24, 2026    │ Ajinkya Thawali        │ Initial version
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 */
public with sharing class OrderBuilderController {

    private static final String DRAFT = 'Draft';
    private static final Integer MAX_PAGE_SIZE = 200;

    /**
     * Retrieves active products from the Standard Price Book.
     *
     * Supports pagination using keyset pagination based on Product Name
     * and PricebookEntry Id. When no cursor is provided, retrieves the
     * first page of products. Otherwise, retrieves products after the
     * previously returned product.
     *
     * @param lastName  Name of the last product from the previous page.
     * @param lastId    Id of the last PricebookEntry from the previous page.
     * @param pageSize  Number of products to retrieve. Defaults to 50
     *                  and is capped at 200.
     * @return List of active PricebookEntry records with product details.
     */
    @AuraEnabled(cacheable=true)
    public static List<PricebookEntry> getProducts(String lastName, Id lastId, Integer pageSize) {
        Integer size = Math.min(pageSize == null ? 50 : pageSize, MAX_PAGE_SIZE);

        // Retrieve the first page when no pagination cursor is provided.
        if (lastId == null) {
            return [
                SELECT Id, Product2Id, Product2.Name, UnitPrice
                FROM PricebookEntry
                WHERE Pricebook2.IsStandard = true
                    AND IsActive = true
                    AND Product2.IsActive = true
                ORDER BY Product2.Name, Id
                LIMIT :size
            ];
        }

        // Retrieve the next page using the last product name and Id as the cursor.
        return [
            SELECT Id, Product2Id, Product2.Name, UnitPrice
            FROM PricebookEntry
            WHERE Pricebook2.IsStandard = true
                AND IsActive = true
                AND Product2.IsActive = true
                AND (
                    Product2.Name > :lastName
                    OR (Product2.Name = :lastName AND Id > :lastId)
                )
            ORDER BY Product2.Name, Id
            LIMIT :size
        ];
    }

    /**
     * Retrieves all order line items for the specified order.
     *
     * Returns product details, pricing, quantity, and total price.
     * The records are ordered by CreatedDate and Id to ensure consistent
     * ordering when multiple records have the same creation timestamp.
     *
     * @param orderId Id of the order whose line items need to be retrieved.
     * @return List of OrderItem records associated with the order.
     */
    @AuraEnabled(cacheable=true)
    public static List<OrderItem> getOrderItems(Id orderId) {
        return [
            SELECT Id, Product2.Name, Product2.Family, UnitPrice, Quantity, TotalPrice
            FROM OrderItem
            WHERE OrderId = :orderId
            ORDER BY CreatedDate, Id
        ];
    }

    /**
     * Adds a product to the specified draft order.
     *
     * If the product already exists on the order, its quantity is
     * incremented by one. Otherwise, a new OrderItem is created with
     * quantity 1 and the PricebookEntry's UnitPrice.
     *
     * If the order does not have a Price Book assigned, the product's
     * Price Book is assigned to the order. If the order already uses
     * a different Price Book, the operation is rejected.
     *
     * @param orderId           Id of the order to which the product is added.
     * @param pricebookEntryId  Id of the selected PricebookEntry.
     */
    @AuraEnabled
    public static void addProduct(Id orderId, Id pricebookEntryId) {

        // Verify that the order exists and is still in Draft status.
        Order ord = getDraftOrder(orderId);

        // Retrieve the selected active PricebookEntry.
        PricebookEntry pbe = [
            SELECT Id, Product2Id, Pricebook2Id, UnitPrice
            FROM PricebookEntry
            WHERE Id = :pricebookEntryId AND IsActive = true
        ];

        // Assign the product's Price Book if the order does not have one.
        if (ord.Pricebook2Id == null) {
            ord.Pricebook2Id = pbe.Pricebook2Id;
            try {
                update ord;
            } catch (DmlException e) {
                throw dmlError('assign pricebook to order', e);
            }

        // Prevent adding products from a different Price Book.
        } else if (ord.Pricebook2Id != pbe.Pricebook2Id) {
            throw error('This order uses a different pricebook than the product list.');
        }

        // Check whether the selected product already exists on the order.
        List<OrderItem> existing = [
            SELECT Id, Quantity
            FROM OrderItem
            WHERE OrderId = :orderId AND Product2Id = :pbe.Product2Id
            LIMIT 1
        ];

        // Create a new order line item if the product does not exist.
        if (existing.isEmpty()) {
            try {
                insert new OrderItem(
                    OrderId = orderId,
                    PricebookEntryId = pbe.Id,
                    Quantity = 1,
                    UnitPrice = pbe.UnitPrice
                );
            } catch (DmlException e) {
                throw dmlError('add product to order', e);
            }

        // Otherwise, increment the existing product's quantity.
        } else {
            existing[0].Quantity += 1;
            try {
                update existing[0];
            } catch (DmlException e) {
                throw dmlError('update product quantity', e);
            }
        }
    }

    /**
     * Removes a product line item from an order.
     *
     * Before deleting the OrderItem, verifies that its parent order
     * exists and is still in Draft status. Activated orders cannot
     * have their line items modified.
     *
     * @param orderItemId Id of the OrderItem record to remove.
     */
    @AuraEnabled
    public static void removeItem(Id orderItemId) {

        // Retrieve the line item and its associated order.
        OrderItem item = [
            SELECT Id, OrderId
            FROM OrderItem
            WHERE Id = :orderItemId
        ];

        // Verify that the associated order is still editable.
        getDraftOrder(item.OrderId);

        // Delete the selected order line item.
         try {
            delete item;
        } catch (DmlException e) {
            throw dmlError('remove product from order', e);
        }
    }

    /**
     * Sends the order details to the configured external API.
     *
     * Builds a JSON payload containing order information and product
     * details, sends it using an HTTP POST request, and validates
     * the response. If the API request succeeds, the order is updated
     * to Activated status, which prevents further modifications.
     *
     * The order must be in Draft status and contain at least one product.
     *
     * @param orderId Id of the order to send to the external API.
     */
    @AuraEnabled
    public static void sendOrder(Id orderId) {

        // Verify that the order exists and is still editable.
        Order ord = getDraftOrder(orderId);

        // Initialize the request payload with order-level information.
        OrderPayload payload = new OrderPayload();
        payload.accountName = ord.Account.Name;
        payload.orderNumber = ord.OrderNumber;
        payload.orderType = ord.Type;
        payload.orderStatus = ord.Status;
        payload.orderProducts = new List<ProductPayload>();

        // Retrieve order line items and add product details to the payload.
        for (OrderItem item : [
            SELECT Product2.Name, ListPrice, Quantity
            FROM OrderItem
            WHERE OrderId = :orderId
            ORDER BY CreatedDate, Id
        ]) {
            ProductPayload p = new ProductPayload();
            p.productName = item.Product2.Name;
            p.listPrice = item.ListPrice;
            p.quantity = item.Quantity;

            // Add the current product to the order payload.
            payload.orderProducts.add(p);
        }

        // Prevent sending an order without any products.
        if (payload.orderProducts.isEmpty()) {
            throw error('Add at least one product before sending the order.');
        }

        // Configure the HTTP request for the external API.
        HttpRequest req = new HttpRequest();
        req.setEndpoint(System.Label.Order_API_Endpoint);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(payload));
        req.setTimeout(20000);

        HttpResponse res;

        // Execute the HTTP callout and handle connectivity exceptions.
        try {
            res = new Http().send(req);
        } catch (CalloutException e) {
            throw error('Could not reach the external API: ' + e.getMessage());
        }

        // Validate that the external API returned a successful HTTP status.
        if (res.getStatusCode() < 200 || res.getStatusCode() > 299) {
            throw error('External API responded with HTTP ' + res.getStatusCode());
        }

        // Activate the order only after the external API request succeeds.
        ord.Status = 'Activated';
        try {
            update ord;
        } catch (DmlException e) {
            throw dmlError('activate order', e);
        }
    }

    // ---- Helper Methods ----

    /**
     * Retrieves and validates an order before allowing modifications.
     *
     * Checks whether the order exists and ensures that it is in Draft
     * status. Orders in any other status are considered locked and
     * cannot be modified through this controller.
     *
     * @param orderId Id of the order to retrieve and validate.
     * @return The validated Order record.
     * @throws AuraHandledException If the order does not exist or is not Draft.
     */
    private static Order getDraftOrder(Id orderId) {

        // Retrieve the order along with the information required by the controller.
        List<Order> orders = [
            SELECT Id, OrderNumber, Type, Status, Pricebook2Id, Account.Name
            FROM Order
            WHERE Id = :orderId
        ];

        // Handle cases where the requested order does not exist.
        if (orders.isEmpty()) {
            throw error('Order not found.');
        }

        // Prevent modifications to orders that are no longer Draft.
        if (orders[0].Status != DRAFT) {
            throw error('This order is locked and can no longer be changed.');
        }

        // Return the validated Draft order.
        return orders[0];
    }

    /**
     * Creates an AuraHandledException with a user-friendly error message.
     *
     * This helper allows controller methods to return meaningful error
     * messages to the Lightning Web Component instead of exposing
     * unhandled Apex exceptions.
     *
     * @param message Error message to display to the user.
     * @return AuraHandledException containing the supplied message.
     */
    private static AuraHandledException error(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }

    /**
     * Handles DML exceptions and returns a user-friendly AuraHandledException.
     *
     * @param operation Description of the operation that failed.
     * @param e         Original DmlException.
     * @return AuraHandledException with the DML error message.
     */
    private static AuraHandledException dmlError(
        String operation,
        DmlException e
    ) {
        String message = 'Unable to ' + operation + ': ' + e.getDmlMessage(0);

        AuraHandledException auraException =
            new AuraHandledException(message);

        auraException.setMessage(message);

        return auraException;
    }

    // ---- External API Payload Classes ----

    /**
     * Represents the complete order payload sent to the external API.
     *
     * The property names are intentionally aligned with the JSON structure
     * expected by the external endpoint.
     */
    public class OrderPayload {

        /** Name of the account associated with the order. */
        public String accountName;

        /** Salesforce order number. */
        public String orderNumber;

        /** Type of the order. */
        public String orderType;

        /** Current status of the order. */
        public String orderStatus;

        /** List of products included in the order. */
        public List<ProductPayload> orderProducts;
    }

    /**
     * Represents an individual product included in the order payload.
     *
     * Contains the product name, list price, and ordered quantity.
     * These fields are serialized as part of the orderProducts array
     * in the outbound JSON request.
     */
    public class ProductPayload {

        /** Name of the product. */
        public String productName;

        /** List price of the product. */
        public Decimal listPrice;

        /** Quantity ordered for the product. */
        public Decimal quantity;
    }
}