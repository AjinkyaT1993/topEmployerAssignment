/**
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 * Class Name      : OrderBuilderController
 * Author          : Ajinkya Thawali
 * Created Date    : Nov 24, 2026
 * Last Modified By: Ajinkya Thawali
 * Last Modified On: Nov 24, 2026
 * Description     : This class implements tro get list of Product and send the data.
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

    /** Active standard-pricebook entries, name-ordered, keyset-paged (lastName + lastId = cursor). */
    @AuraEnabled(cacheable=true)
    public static List<PricebookEntry> getProducts(String lastName, Id lastId, Integer pageSize) {
        Integer size = Math.min(pageSize == null ? 50 : pageSize, MAX_PAGE_SIZE);
        if (lastId == null) {
            return [
                SELECT Id, Product2Id, Product2.Name, UnitPrice
                FROM PricebookEntry
                WHERE Pricebook2.IsStandard = true AND IsActive = true AND Product2.IsActive = true
                ORDER BY Product2.Name, Id
                LIMIT :size
            ];
        }
        return [
            SELECT Id, Product2Id, Product2.Name, UnitPrice
            FROM PricebookEntry
            WHERE Pricebook2.IsStandard = true AND IsActive = true AND Product2.IsActive = true
              AND (Product2.Name > :lastName OR (Product2.Name = :lastName AND Id > :lastId))
            ORDER BY Product2.Name, Id
            LIMIT :size
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<OrderItem> getOrderItems(Id orderId) {
        return [
            SELECT Id, Product2.Name, Product2.Family, UnitPrice, Quantity, TotalPrice
            FROM OrderItem
            WHERE OrderId = :orderId
            ORDER BY CreatedDate, Id
        ];
    }

    /** Adds the product with quantity 1, or increases the quantity of the existing line by 1. */
    @AuraEnabled
    public static void addProduct(Id orderId, Id pricebookEntryId) {
        Order ord = getDraftOrder(orderId);
        PricebookEntry pbe = [
            SELECT Id, Product2Id, Pricebook2Id, UnitPrice
            FROM PricebookEntry
            WHERE Id = :pricebookEntryId AND IsActive = true
        ];
        if (ord.Pricebook2Id == null) {
            ord.Pricebook2Id = pbe.Pricebook2Id;
            update ord;
        } else if (ord.Pricebook2Id != pbe.Pricebook2Id) {
            throw error('This order uses a different pricebook than the product list.');
        }

        List<OrderItem> existing = [
            SELECT Id, Quantity FROM OrderItem
            WHERE OrderId = :orderId AND Product2Id = :pbe.Product2Id
            LIMIT 1
        ];
        if (existing.isEmpty()) {
            insert new OrderItem(
                OrderId = orderId,
                PricebookEntryId = pbe.Id,
                Quantity = 1,
                UnitPrice = pbe.UnitPrice
            );
        } else {
            existing[0].Quantity += 1;
            update existing[0];
        }
    }

    @AuraEnabled
    public static void removeItem(Id orderItemId) {
        OrderItem item = [SELECT Id, OrderId FROM OrderItem WHERE Id = :orderItemId];
        getDraftOrder(item.OrderId);
        delete item;
    }

    /** POSTs the order as JSON to the external API, then activates the order (which locks it). */
    @AuraEnabled
    public static void sendOrder(Id orderId) {
        Order ord = getDraftOrder(orderId);
        OrderPayload payload = new OrderPayload();
        payload.accountName = ord.Account.Name;
        payload.orderNumber = ord.OrderNumber;
        payload.orderType = ord.Type;
        payload.orderStatus = ord.Status;
        payload.orderProducts = new List<ProductPayload>();
        for (OrderItem item : [
            SELECT Product2.Name, ListPrice, Quantity FROM OrderItem WHERE OrderId = :orderId ORDER BY CreatedDate, Id
        ]) {
            ProductPayload p = new ProductPayload();
            p.productName = item.Product2.Name;
            p.listPrice = item.ListPrice;
            p.quantity = item.Quantity;
            payload.orderProducts.add(p);
        }
        if (payload.orderProducts.isEmpty()) {
            throw error('Add at least one product before sending the order.');
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint(System.Label.Order_API_Endpoint);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(payload));
        req.setTimeout(20000);

        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (CalloutException e) {
            throw error('Could not reach the external API: ' + e.getMessage());
        }
        if (res.getStatusCode() < 200 || res.getStatusCode() > 299) {
            throw error('External API responded with HTTP ' + res.getStatusCode());
        }

        ord.Status = 'Activated';
        update ord;
    }

    // ---- helpers ----
    private static Order getDraftOrder(Id orderId) {
        List<Order> orders = [
            SELECT Id, OrderNumber, Type, Status, Pricebook2Id, Account.Name
            FROM Order WHERE Id = :orderId
        ];
        if (orders.isEmpty()) {
            throw error('Order not found.');
        }
        if (orders[0].Status != DRAFT) {
            throw error('This order is locked and can no longer be changed.');
        }
        return orders[0];
    }

    private static AuraHandledException error(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }

    // ---- external API payload (property names match the required JSON) ----
    public class OrderPayload {
        public String accountName;
        public String orderNumber;
        public String orderType;
        public String orderStatus;
        public List<ProductPayload> orderProducts;
    }

    public class ProductPayload {
        public String productName;
        public Decimal listPrice;
        public Decimal quantity;
    }
}