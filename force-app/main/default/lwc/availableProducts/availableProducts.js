/**
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 * LWC Name        : AvailableProducts
 * Author          : Ajinkya Thawali
 * Created Date    : Nov 24, 2026
 * Last Modified By: Ajinkya Thawali
 * Last Modified On: Nov 24, 2026
 * Description     : This component displays available products in a datatable.
 *
 * Change History  :
 *  Date            │      Author            │   Change
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 *  Nov 24, 2026    │ Ajinkya Thawali        │ Initial version
 * ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
 */

import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { publish, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CURRENCY from '@salesforce/i18n/currency';
import ORDER_CHANNEL from '@salesforce/messageChannel/OrderBuilder__c';
import ORDER_STATUS from '@salesforce/schema/Order.Status';
import getProducts from '@salesforce/apex/OrderBuilderController.getProducts';

// Number of products to retrieve from Apex in each pagination request.
const PAGE_SIZE = 100;

/**
 * AvailableProducts
 *
 * Displays active products from the Standard Price Book in a datatable.
 * Supports lazy loading/pagination, displays product prices in the user's
 * currency, and allows users to add products to an order using Lightning
 * Message Service.
 *
 * Products cannot be added when the associated order is no longer in Draft status.
 */
export default class AvailableProducts extends LightningElement {

    // Record Id of the current Order record page.
    // Salesforce automatically provides this value when the component
    // is placed on a record page.
    @api recordId;

    // Stores the products retrieved from Apex across multiple pages.
    products = [];

    // Indicates whether additional products are available to retrieve.
    // Set to false when the last page of products has been loaded
    // or when an error occurs during loading.
    hasMore = true;

    // Prevents multiple pagination requests from executing simultaneously.
    isLoading = false;

    // Configuration for the products datatable.
    columns = [
        // Displays the product name and allows the text to wrap.
        { label: 'Name', fieldName: 'name', wrapText: true },

        // Displays the product's list price using the user's currency.
        {
            label: 'List Price',
            fieldName: 'listPrice',
            type: 'currency',
            typeAttributes: { currencyCode: CURRENCY },
            cellAttributes: { alignment: 'left' }
        },

        // Displays an add-product icon button for each row.
        {
            label: '',
            type: 'button-icon',
            fixedWidth: 50,
            typeAttributes: {
                // Identifies the action when the button is clicked.
                name: 'add',

                // Salesforce utility icon displayed on the button.
                iconName: 'utility:add',

                // Tooltip displayed when the user hovers over the button.
                title: 'Add to order',

                // Accessible label for screen readers.
                alternativeText: 'Add to order',

                // Disables the button when the order is locked.
                disabled: { fieldName: 'locked' }
            }
        }
    ];

    // Provides the Lightning Message Service context required
    // to publish messages to other Lightning components.
    @wire(MessageContext)
    messageContext;

    // Retrieves the current Order record's Status field.
    // Automatically refreshes when the recordId changes.
    @wire(getRecord, {
        recordId: '$recordId',
        fields: [ORDER_STATUS]
    })
    order;

    /**
     * Determines whether the current order is locked.
     *
     * An order is considered locked when its status is available
     * and the status is anything other than Draft.
     *
     * Returns false while the Order record is still loading.
     *
     * @return Boolean indicating whether the order is locked.
     */
    get isLocked() {
        return !!this.order.data &&
            getFieldValue(this.order.data, ORDER_STATUS) !== 'Draft';
    }

    /**
     * Returns the product list with an additional locked property.
     *
     * The locked property is used by the datatable to disable
     * the Add button when the order is not in Draft status.
     *
     * This getter recalculates the rows whenever the products
     * or the order status changes.
     *
     * @return Array of product rows with the locked property.
     */
    get rows() {
        return this.products.map((p) => ({
            ...p,
            locked: this.isLocked
        }));
    }

    /**
     * Lifecycle hook executed when the component is inserted
     * into the DOM.
     *
     * Initiates the initial product retrieval by loading
     * the first page of products.
     */
    connectedCallback() {
        this.loadMore();
    }

    /**
     * Retrieves the next page of products from Apex.
     *
     * Uses keyset pagination based on the last loaded product's
     * name and Id. This avoids using OFFSET pagination and allows
     * efficient retrieval of large product lists.
     *
     * Prevents duplicate requests when a request is already
     * in progress or when no more products are available.
     *
     * On successful retrieval:
     * - Maps PricebookEntry records into the component's product format.
     * - Appends the newly retrieved products to the existing list.
     * - Determines whether another page is available.
     *
     * On failure:
     * - Stops further pagination.
     * - Displays an error toast to the user.
     *
     * The loading flag is reset in the finally block regardless
     * of whether the request succeeds or fails.
     */
    async loadMore() {

        // Debug log to track the pagination method execution.
        console.log('on load More 1');

        // Debug log to check whether a request is already running.
        console.log('this.isLoading:::', this.isLoading);

        // Debug log to check whether additional records are available.
        console.log('!this.hasMore:::', !this.hasMore);

        // Exit if another request is in progress or no more products exist.
        if (this.isLoading || !this.hasMore) {
            return;
        }

        // Mark the request as in progress to prevent duplicate calls.
        this.isLoading = true;

        try {

            // Retrieve the last product currently loaded.
            // This product will be used as the pagination cursor.
            const last = this.products[this.products.length - 1];

            // Debug log for the last loaded product.
            console.log('last:::', last);

            // Debug log for the current number of loaded products.
            console.log('this.products.length:::', this.products.length);

            // Call the Apex method to retrieve the next page.
            // The last product's name and Id are passed to support
            // keyset pagination. For the first request, these values
            // are undefined.
            const page = await getProducts({
                lastName: last?.name,
                lastId: last?.id,
                pageSize: PAGE_SIZE
            });

            // Debug log for the records returned by Apex.
            console.log('page:::', page);

            // Convert the returned PricebookEntry records into the
            // structure required by the datatable.
            // Append the new products without replacing existing records.
            this.products = [
                ...this.products,
                ...page.map((pbe) => ({
                    id: pbe.Id,
                    name: pbe.Product2.Name,
                    listPrice: pbe.UnitPrice
                }))
            ];

            // Debug log for the updated product list.
            console.log('this.products:::', this.products);

            // Debug log for the updated product count.
            console.log('this.products.length:::', this.products.length);

            // If the returned page contains PAGE_SIZE records,
            // another page may exist. Otherwise, the last page
            // has been reached.
            this.hasMore = page.length === PAGE_SIZE;

            // Debug log indicating whether another page is available.
            console.log('this.hasMore:::', this.hasMore);

        } catch (e) {

            // Stop further pagination after an error.
            this.hasMore = false;

            // Display an error toast with the Apex or JavaScript error message.
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not load products',
                    message: e?.body?.message || e?.message,
                    variant: 'error'
                })
            );

        } finally {

            // Reset the loading flag after the request completes,
            // regardless of success or failure.
            this.isLoading = false;
        }
    }

    /**
     * Handles actions performed on a datatable row.
     *
     * When the user clicks the Add button, publishes a message
     * through Lightning Message Service containing the selected
     * PricebookEntry Id.
     *
     * Other components subscribed to ORDER_CHANNEL can receive
     * this message and add the selected product to the order.
     *
     * @param event Datatable row action event.
     */
    handleRowAction(event) {

        // Check whether the selected row action is the Add action.
        if (event.detail.action.name === 'add') {

            // Publish the selected PricebookEntry Id through
            // Lightning Message Service so another component
            // can process the request and add the product.
            publish(
                this.messageContext,
                ORDER_CHANNEL,
                {
                    pricebookEntryId: event.detail.row.id
                }
            );
        }
    }
}