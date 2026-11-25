/**
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 * LWC Name        : OrderItems
 * Author          : Ajinkya Thawali
 * Created Date    : Nov 24, 2026
 * Last Modified By: Ajinkya Thawali
 * Last Modified On: Nov 24, 2026
 * Description     : This component displays order items in a datatable.
 *
 * Change History  :
 *  Date            │      Author            │   Change
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 *  Nov 24, 2026    │ Ajinkya Thawali        │ Initial version
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 */

import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue, notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import CURRENCY from '@salesforce/i18n/currency';
import ORDER_CHANNEL from '@salesforce/messageChannel/OrderBuilder__c';
import ORDER_STATUS from '@salesforce/schema/Order.Status';
import getOrderItems from '@salesforce/apex/OrderBuilderController.getOrderItems';
import addProduct from '@salesforce/apex/OrderBuilderController.addProduct';
import removeItem from '@salesforce/apex/OrderBuilderController.removeItem';
import sendOrder from '@salesforce/apex/OrderBuilderController.sendOrder';

export default class OrderItems extends LightningElement {

    // Id of the current Order record.
    // Automatically populated when the component is placed on an Order record page.
    @api recordId;

    // Currency code used to display monetary values in the user's currency.
    currencyCode = CURRENCY;

    // Stores the order line items retrieved from Apex.
    items = [];

    // Tracks the number of asynchronous operations currently in progress.
    // Used to control loading states and prevent conflicting actions.
    pending = 0;

    // Stores the Lightning Message Service subscription reference.
    // Used to unsubscribe when the component is removed from the DOM.
    subscription;

    // Stores the result of the wired Apex call.
    // Required by refreshApex to refresh the order item data.
    wiredItems;

    // Maintains a sequential execution queue for order modifications.
    // Serialises changes so rapid "add" clicks can't create duplicate lines.
    queue = Promise.resolve(); // serialises changes so rapid "add" clicks can't create duplicate lines

    // Defines the columns displayed in the order items datatable.
    columns = [

        // Displays the product name with wrapping enabled.
        { label: 'Name', fieldName: 'name', wrapText: true },

        // Displays the unit price using the user's currency.
        { label: 'Unit Price', fieldName: 'unitPrice', type: 'currency', typeAttributes: { currencyCode: CURRENCY },cellAttributes: {alignment: 'left'} },

        // Displays the quantity of the product ordered.
        { label: 'Quantity', fieldName: 'quantity', type: 'number', cellAttributes: { alignment: 'left' } },

        // Displays the total price for the order line item.
        { label: 'Total Price', fieldName: 'totalPrice', type: 'currency', typeAttributes: { currencyCode: CURRENCY },cellAttributes: {alignment: 'left'} },

        // Displays the delete icon button for removing a product from the order.
        {
            label: '',
            type: 'button-icon',
            fixedWidth: 50,
            typeAttributes: {

                // Identifies the row action when the button is clicked.
                name: 'remove',

                // Displays the delete utility icon.
                iconName: 'utility:delete',

                // Tooltip shown when the user hovers over the button.
                title: 'Remove from order',

                // Accessible text for screen readers.
                alternativeText: 'Remove from order',

                // Disables the delete button when the order is locked.
                disabled: { fieldName: 'locked' }
            }
        }
    ];

    // Provides the Lightning Message Service context required
    // to subscribe to messages from other Lightning components.
    @wire(MessageContext) messageContext;

    // Retrieves the Order record's Status field.
    // Automatically refreshes when the recordId changes.
    @wire(getRecord, { recordId: '$recordId', fields: [ORDER_STATUS] }) order;

    /**
     * Retrieves the order line items from Apex.
     *
     * Maps the returned OrderItem records into a simplified structure
     * used by the datatable and calculations.
     *
     * Stores the wire result for later refreshing using refreshApex.
     *
     * Displays an error toast if the retrieval fails.
     *
     * @param result Result returned by the wired Apex method.
     */
    @wire(getOrderItems, { orderId: '$recordId' })
    wiredOrderItems(result) {

        // Store the complete wire result so it can be refreshed later.
        this.wiredItems = result;

        // Process the retrieved order items when data is available.
        if (result.data) {

            // Transform OrderItem records into the component's data structure.
            this.items = result.data.map((i) => ({
                id: i.Id,
                name: i.Product2.Name,

                // Use the product family when available.
                // Otherwise, assign a default value.
                family: i.Product2.Family || 'No Family',

                // Store the unit price of the product.
                unitPrice: i.UnitPrice,

                // Store the ordered quantity.
                quantity: i.Quantity,

                // Store the total price for the line item.
                totalPrice: i.TotalPrice
            }));

        // Handle errors returned by the Apex wire.
        } else if (result.error) {

            // Display an error toast to inform the user.
            this.toast('Could not load order items', this.message(result.error), 'error');
        }
    }

    /**
     * Determines whether the current order is locked.
     *
     * An order is locked when its status is available
     * and is not Draft.
     *
     * Returns false while the Order record is loading.
     *
     * @return Boolean indicating whether the order is locked.
     */
    get isLocked() {
        return !!this.order.data && getFieldValue(this.order.data, ORDER_STATUS) !== 'Draft';
    }

    /**
     * Determines whether any asynchronous operation is in progress.
     *
     * The pending counter is incremented when an operation starts
     * and decremented when the operation completes.
     *
     * @return Boolean indicating whether the component is busy.
     */
    get isBusy() {
        return this.pending > 0;
    }

    /**
     * Checks whether the order contains any line items.
     *
     * @return Boolean indicating whether the order has products.
     */
    get hasItems() {
        return this.items.length > 0;
    }

    /**
     * Determines whether the Send Order action should be disabled.
     *
     * The order cannot be sent when:
     * - The order is already locked.
     * - The order does not contain any products.
     * - An asynchronous operation is currently running.
     *
     * @return Boolean indicating whether sending is disabled.
     */
    get cannotSend() {
        return this.isLocked || !this.hasItems || this.isBusy;
    }

    /**
     * Returns the order items with an additional locked property.
     *
     * The locked property is used by the datatable to disable
     * the Remove button when the order is no longer in Draft status.
     *
     * @return Array of order items with the locked property.
     */
    get rows() {
        return this.items.map((i) => ({ ...i, locked: this.isLocked }));
    }

    /**
     * Calculates the total price for each product family.
     *
     * Uses a Map to group order items by product family and
     * accumulates the total price for each family.
     *
     * The resulting totals are sorted alphabetically by family
     * and returned in an array for display.
     *
     * The calculation is performed in the client-side component
     * rather than in Apex.
     *
     * @return Array containing family names and their total prices.
     */
    // Calculated here (not in Apex) and recalculated whenever `items` changes.
    get familyTotals() {

        // Map used to store product family and its accumulated total.
        const totals = new Map();

        // Group order items by family and calculate the total price.
        this.items.forEach((i) => totals.set(i.family, (totals.get(i.family) || 0) + i.totalPrice));

        // Convert the Map into an array, sort by family name,
        // and transform it into objects for UI display.
        return [...totals]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([family, total]) => ({ family, total }));
    }

    /**
     * Calculates the grand total of the order.
     *
     * Adds the TotalPrice of every order item.
     *
     * @return Total amount of all order line items.
     */
    get orderTotal() {

        // Sum the total price of all products in the order.
        return this.items.reduce((sum, i) => sum + i.totalPrice, 0);
    }

    /**
     * Lifecycle hook executed when the component is inserted into the DOM.
     *
     * Subscribes to the OrderBuilder Lightning Message Service channel.
     * When another component publishes a product selection message,
     * the selected product is added to the current order.
     *
     * The add operation is executed through the run method to ensure
     * sequential processing, error handling, and data refresh.
     */
    connectedCallback() {

        // Subscribe to the OrderBuilder message channel.
        // The callback is invoked whenever another component
        // publishes a message to this channel.
        this.subscription = subscribe(this.messageContext, ORDER_CHANNEL, (msg) =>

            // Add the selected product to the current order.
            // The run method serialises the operation and handles
            // refresh, loading state, and errors.
            this.run(() => addProduct({ orderId: this.recordId, pricebookEntryId: msg.pricebookEntryId }))
        );
    }

    /**
     * Lifecycle hook executed when the component is removed from the DOM.
     *
     * Unsubscribes from Lightning Message Service to prevent
     * unnecessary callbacks and avoid retaining the subscription.
     */
    disconnectedCallback() {

        // Remove the Lightning Message Service subscription.
        unsubscribe(this.subscription);
    }

    /**
     * Handles datatable row-level actions.
     *
     * When the user clicks the Remove button, invokes the Apex
     * removeItem method for the selected OrderItem.
     *
     * The operation is executed through run to ensure sequential
     * processing and refresh the UI after completion.
     *
     * @param event Datatable row action event.
     */
    handleRowAction(event) {

        // Check whether the selected action is Remove.
        if (event.detail.action.name === 'remove') {

            // Delete the selected OrderItem using its Id.
            this.run(() => removeItem({ orderItemId: event.detail.row.id }));
        }
    }

    /**
     * Handles the Send Order button action.
     *
     * Displays a confirmation dialog before sending the order
     * to the external API.
     *
     * If the user confirms, calls the Apex sendOrder method.
     * On successful completion, displays the "Order sent" toast.
     *
     * @return Promise resolving after the confirmation and operation.
     */
    async handleSend() {

        // Ask the user to confirm sending the order.
        // The user is informed that the order will be locked afterwards.
        const confirmed = await LightningConfirm.open({
            message: 'Send this order to the external API? The order will be locked afterwards.',
            label: 'Send order',
            theme: 'warning'
        });

        // Proceed only when the user confirms the action.
        if (confirmed) {

            // Send the order to the external API.
            // Display a success toast after the operation completes.
            this.run(() => sendOrder({ orderId: this.recordId }), 'Order sent');
        }
    }

    /**
     * Executes an asynchronous operation in a sequential queue.
     *
     * Increments the pending counter to indicate that an operation
     * is in progress.
     *
     * Executes the supplied task after previously queued operations.
     * After the task succeeds:
     * - Refreshes the order item data.
     * - Refreshes the current Order record.
     * - Displays a success toast when a success message is provided.
     *
     * If an error occurs, displays an error toast.
     *
     * Finally, decrements the pending counter regardless of success
     * or failure.
     *
     * @param task            Asynchronous function to execute.
     * @param successMessage  Optional message to display after success.
     */
    run(task, successMessage) {

        // Increment the counter to indicate that an operation is pending.
        this.pending++;

        // Append the operation to the existing promise queue.
        // This ensures that order modifications are executed sequentially.
        this.queue = this.queue

            // Execute the current task after previous queued operations finish.
            .then(async () => {

                // Execute the supplied Apex operation.
                await task();

                // Refresh the wired order items to retrieve the latest data.
                await refreshApex(this.wiredItems);

                // Notify Lightning Data Service that the Order record changed.
                // This refreshes the Order status and related record page data.
                await notifyRecordUpdateAvailable([{ recordId: this.recordId }]); // refreshes status + record page

                // Display a success toast if a success message was provided.
                if (successMessage) {
                    this.toast(successMessage, '', 'success');
                }
            })

            // Handle any error that occurs during the task or refresh operations.
            .catch((e) => this.toast('Error', this.message(e), 'error'))

            // Always decrement the pending counter when the operation finishes.
            .finally(() => {
                this.pending--;
            });
    }

    /**
     * Extracts a readable error message from an Apex or JavaScript error.
     *
     * Prioritises the Salesforce Apex error message.
     * Falls back to the JavaScript error message.
     * Returns a generic message when neither is available.
     *
     * @param e Error object.
     * @return Readable error message.
     */
    message(e) {

        // Return the Apex error message, JavaScript error message,
        // or a default message if no error details are available.
        return e?.body?.message || e?.message || 'Unknown error';
    }

    /**
     * Displays a Salesforce toast notification.
     *
     * Creates and dispatches a ShowToastEvent with the supplied
     * title, message, and notification variant.
     *
     * Supported variants include success, error, warning, and info.
     *
     * @param title   Title of the toast notification.
     * @param message Message displayed in the toast.
     * @param variant Type of toast notification.
     */
    toast(title, message, variant) {

        // Dispatch the toast event to display a notification to the user.
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}