
# Order Builder (Salesforce DX project)

An Order record page made of two LWC components:

| Component | What it does |
|---|---|
| `availableProducts` | 2-column list (Name, List Price) of products with an **active standard-pricebook entry**. Each product appears once. Loads 50 at a time via infinite scroll (optional requirement 1, replaces the 100 cap). A `+` button adds the product to the order. |
| `orderItems` | Table of order lines (Name, Unit Price, Quantity, Total Price) with remove button, **per-Product-Family subtotals and order total calculated in the component**, and a **Send Order** button (optional requirement 2). |

The page is the `Order_Builder` Lightning record page, so the **order Id comes from the record URL** (`/lightning/r/Order/<orderId>/view`).

## How it works

- Adding a product that is not on the order creates a line with quantity 1; adding one that is already there increases the quantity by 1.
- The two components talk through a Lightning Message Service channel (`OrderBuilder`). `orderItems` owns all order changes; changes are queued so rapid clicks can't create duplicate lines.
- **Send Order** POSTs the JSON below to the configured external endpoint and, on a 2xx response, sets the order `Status` to `Activated`.
- Both components treat any non-`Draft` order as read-only (and Apex enforces it too).

### External Integration Endpoint

The external integration endpoint is configured using the `Order_API_Endpoint` custom label and the `Order_API` Remote Site Setting.

**Configured endpoint:**

`https://topemployerorder.requestcatcher.com/`

This endpoint is used to receive the order payload when the **Send Order** button is clicked.

The endpoint configuration is included in the Salesforce package, so no manual endpoint URL replacement is required after deployment.

### Payload sent to the endpoint

```json
{
  "accountName": "",
  "orderNumber": "",
  "orderType": "",
  "orderStatus": "",
  "orderProducts": [
    {
      "productName": "",
      "listPrice": 0,
      "quantity": 0
    }
  ]
}
```

## Deploy to your Developer org

### Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`)
- A free [Developer Edition org](https://salesforce.com/signup) or Trailhead Playground

### 1. Log in

```bash
sf org login web --alias devorg --set-default
```

### 2. External API endpoint configuration

The RequestCatcher endpoint has already been configured in the project/package:

`https://topemployerorder.requestcatcher.com/`

It is configured in the following Salesforce metadata files:

- `force-app/main/default/labels/CustomLabels.labels-meta.xml`
- `force-app/main/default/remoteSiteSettings/Order_API.remoteSite-meta.xml`

No additional configuration or URL replacement is required.

### 3. Deploy and run the tests

```bash
sf project deploy start --source-dir force-app --test-level RunSpecifiedTests --tests OrderBuilderControllerTest
```

Alternatively:

```bash
sf project deploy start --manifest manifest/package.xml
```

### 4. Create demo data

The seed script creates 120 products, an account, and a Draft order.

```bash
sf apex run --file scripts/apex/seed-data.apex
```

Copy the Order Id from the `>>> Open this order` debug line (or open any Draft order from the **Orders** tab).

### 5. Open the order

```bash
sf org open --path /lightning/r/Order/<orderId>/view
```

The deployment also sets `Order_Builder` as the org's default Order record page (see `objects/Order/Order.object-meta.xml`).

If you'd rather not override the default page, delete that file and activate the page manually in Lightning App Builder.

## Troubleshooting

- **No products listed:** Products need an *active* entry in the *Standard Price Book*. The seed script does this.
- **Orders tab/object missing:** Orders must be enabled (Setup → Order Settings).
- **Send Order fails:** Verify that the endpoint is configured correctly and that the user has permission to activate orders.
- **Non-admin users:** Need access to the `OrderBuilderController` Apex class (e.g. through a permission set).

## Project layout

```text
force-app/main/default/
  classes/            OrderBuilderController (+ test)
  lwc/                availableProducts, orderItems
  messageChannels/     OrderBuilder
  flexipages/         Order_Builder
  labels/
  remoteSiteSettings/
  objects/Order/

scripts/apex/seed-data.apex
manifest/package.xml
```
