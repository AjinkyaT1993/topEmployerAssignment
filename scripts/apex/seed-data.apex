// Creates 120 demo products (standard pricebook), an account and a Draft order.
// Run: sf apex run --file scripts/apex/seed-data.apex
Pricebook2 std = [SELECT Id, IsActive FROM Pricebook2 WHERE IsStandard = true LIMIT 1];
if (!std.IsActive) {
    std.IsActive = true;
    update std;
}

List<String> families = new List<String>{ 'Hardware', 'Software', 'Services' };
List<Product2> products = new List<Product2>();
for (Integer i = 1; i <= 120; i++) {
    products.add(new Product2(
        Name = 'Demo Product ' + String.valueOf(i).leftPad(3, '0'),
        ProductCode = 'DEMO-' + i,
        Family = families[Math.mod(i, 3)],
        IsActive = true
    ));
}
insert products; 

List<PricebookEntry> entries = new List<PricebookEntry>();
for (Integer i = 0; i < products.size(); i++) {
    entries.add(new PricebookEntry(
        Pricebook2Id = std.Id,
        Product2Id = products[i].Id,
        UnitPrice = 9.99 + (i * 2.5),
        IsActive = true
    ));
}
insert entries;

Account acc = new Account(Name = 'Demo Account');
insert acc;
Order ord = new Order(AccountId = acc.Id, EffectiveDate = Date.today(), Status = 'Draft', Pricebook2Id = std.Id);
insert ord;

System.debug('>>> Open this order: /lightning/r/Order/' + ord.Id + '/view');
