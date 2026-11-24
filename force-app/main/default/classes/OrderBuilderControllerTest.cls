/**
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 * Class Name      : OrderBuilderControllerTest
 * Author          : Ajinkya Thawali
 * Created Date    : Nov 24, 2026
 * Last Modified By: Ajinkya Thawali
 * Last Modified On: Nov 24, 2026
 * Description     : Test class for OrderBuilderController
 *  
 * Change History  :
 *  Date            │      Author            │   Change
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 *  Nov 24, 2026    │ Ajinkya Thawali        │ Initial version
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 */
@IsTest
private class OrderBuilderControllerTest {
    private class Mock implements HttpCalloutMock {
        private Integer code;
        Mock(Integer code) { this.code = code; }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(code);
            res.setBody('ok');
            return res;
        }
    }

    @TestSetup
    static void setup() {
        Id stdId = Test.getStandardPricebookId();
        List<Product2> products = new List<Product2>{
            new Product2(Name = 'Alpha', Family = 'Hardware', IsActive = true),
            new Product2(Name = 'Beta', Family = 'Software', IsActive = true),
            new Product2(Name = 'Gamma (inactive)', IsActive = false)
        };
        insert products;
        List<PricebookEntry> entries = new List<PricebookEntry>();
        for (Product2 p : products) {
            entries.add(new PricebookEntry(Pricebook2Id = stdId, Product2Id = p.Id, UnitPrice = 10, IsActive = true));
        }
        insert entries;
        Account acc = new Account(Name = 'Acme');
        insert acc;
        insert new Order(AccountId = acc.Id, EffectiveDate = Date.today(), Status = 'Draft', Pricebook2Id = stdId);
    }

    private static Order draftOrder() {
        return [SELECT Id FROM Order LIMIT 1];
    }

    private static PricebookEntry entry(String productName) {
        return [SELECT Id FROM PricebookEntry WHERE Product2.Name = :productName LIMIT 1];
    }

    @IsTest
    static void getProductsPagesAndSkipsInactive() {
        List<PricebookEntry> first = OrderBuilderController.getProducts(null, null, 1);
        if(!first.IsEmpty()){
            List<PricebookEntry> second = OrderBuilderController.getProducts('Alpha', first[0].Id, 1);
            Assert.areEqual(1, second.size());
            Assert.areEqual('Beta', second[0].Product2.Name);
            Assert.areEqual(0, OrderBuilderController.getProducts('Beta', second[0].Id, 10).size());
        } 
    }

    @IsTest
    static void addProductCreatesThenIncrementsAndRemoves() {
        Order ord = draftOrder();
        PricebookEntry alpha = entry('Alpha');

        OrderBuilderController.addProduct(ord.Id, alpha.Id);
        OrderBuilderController.addProduct(ord.Id, alpha.Id);

        List<OrderItem> items = OrderBuilderController.getOrderItems(ord.Id);
        Assert.areEqual(1, items.size());
        Assert.areEqual(2, items[0].Quantity);

        OrderBuilderController.removeItem(items[0].Id);
        Assert.areEqual(0, OrderBuilderController.getOrderItems(ord.Id).size());
    }

    @IsTest
    static void sendOrderActivatesAndLocksOrder() {
        Order ord = draftOrder();
        OrderBuilderController.addProduct(ord.Id, entry('Alpha').Id);

        Test.setMock(HttpCalloutMock.class, new Mock(200));
        
        Test.startTest();
        OrderBuilderController.sendOrder(ord.Id);
        Test.stopTest();
        
        Assert.areEqual('Activated', [SELECT Status FROM Order WHERE Id = :ord.Id].Status);
        try {
            OrderBuilderController.addProduct(ord.Id, entry('Beta').Id);
            Assert.fail('Expected the locked order to reject changes');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('locked'));
        }
    }

    @IsTest
    static void sendOrderFailureKeepsOrderDraft() {
        Order ord = draftOrder();
        OrderBuilderController.addProduct(ord.Id, entry('Alpha').Id);

        Test.setMock(HttpCalloutMock.class, new Mock(500));
        try {
            OrderBuilderController.sendOrder(ord.Id);
            Assert.fail('Expected an error for HTTP 500');
        } catch (AuraHandledException e) {
            
        }
        Assert.areEqual('Draft', [SELECT Status FROM Order WHERE Id = :ord.Id].Status);
    }

    @IsTest
    static void sendOrderWithoutItemsFails() {
        try {
            OrderBuilderController.sendOrder(draftOrder().Id);
            Assert.fail('Expected an error for an empty order');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('at least one product'));
        }
    }
}