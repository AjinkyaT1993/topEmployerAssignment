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
    @api recordId;

    currencyCode = CURRENCY;
    items = [];
    pending = 0;
    subscription;
    wiredItems;
    queue = Promise.resolve(); // serialises changes so rapid "add" clicks can't create duplicate lines

    columns = [
        { label: 'Name', fieldName: 'name', wrapText: true },
        { label: 'Unit Price', fieldName: 'unitPrice', type: 'currency', typeAttributes: { currencyCode: CURRENCY },cellAttributes: {alignment: 'left'} },
        { label: 'Quantity', fieldName: 'quantity', type: 'number', cellAttributes: { alignment: 'left' } },
        { label: 'Total Price', fieldName: 'totalPrice', type: 'currency', typeAttributes: { currencyCode: CURRENCY },cellAttributes: {alignment: 'left'} },
        {
            label: '',
            type: 'button-icon',
            fixedWidth: 50,
            typeAttributes: {
                name: 'remove',
                iconName: 'utility:delete',
                title: 'Remove from order',
                alternativeText: 'Remove from order',
                disabled: { fieldName: 'locked' }
            }
        }
    ];

    @wire(MessageContext) messageContext;
    @wire(getRecord, { recordId: '$recordId', fields: [ORDER_STATUS] }) order;

    @wire(getOrderItems, { orderId: '$recordId' })
    wiredOrderItems(result) {
        this.wiredItems = result;
        if (result.data) {
            this.items = result.data.map((i) => ({
                id: i.Id,
                name: i.Product2.Name,
                family: i.Product2.Family || 'No Family',
                unitPrice: i.UnitPrice,
                quantity: i.Quantity,
                totalPrice: i.TotalPrice
            }));
        } else if (result.error) {
            this.toast('Could not load order items', this.message(result.error), 'error');
        }
    }

    get isLocked() {
        return !!this.order.data && getFieldValue(this.order.data, ORDER_STATUS) !== 'Draft';
    }
    get isBusy() {
        return this.pending > 0;
    }
    get hasItems() {
        return this.items.length > 0;
    }
    get cannotSend() {
        return this.isLocked || !this.hasItems || this.isBusy;
    }
    get rows() {
        return this.items.map((i) => ({ ...i, locked: this.isLocked }));
    }

    // Calculated here (not in Apex) and recalculated whenever `items` changes.
    get familyTotals() {
        const totals = new Map();
        this.items.forEach((i) => totals.set(i.family, (totals.get(i.family) || 0) + i.totalPrice));
        return [...totals]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([family, total]) => ({ family, total }));
    }
    get orderTotal() {
        return this.items.reduce((sum, i) => sum + i.totalPrice, 0);
    }

    connectedCallback() {
        this.subscription = subscribe(this.messageContext, ORDER_CHANNEL, (msg) =>
            this.run(() => addProduct({ orderId: this.recordId, pricebookEntryId: msg.pricebookEntryId }))
        );
    }

    disconnectedCallback() {
        unsubscribe(this.subscription);
    }

    handleRowAction(event) {
        if (event.detail.action.name === 'remove') {
            this.run(() => removeItem({ orderItemId: event.detail.row.id }));
        }
    }

    async handleSend() {
        const confirmed = await LightningConfirm.open({
            message: 'Send this order to the external API? The order will be locked afterwards.',
            label: 'Send order',
            theme: 'warning'
        });
        if (confirmed) {
            this.run(() => sendOrder({ orderId: this.recordId }), 'Order sent');
        }
    }

    run(task, successMessage) {
        this.pending++;
        this.queue = this.queue
            .then(async () => {
                await task();
                await refreshApex(this.wiredItems);
                await notifyRecordUpdateAvailable([{ recordId: this.recordId }]); // refreshes status + record page
                if (successMessage) {
                    this.toast(successMessage, '', 'success');
                }
            })
            .catch((e) => this.toast('Error', this.message(e), 'error'))
            .finally(() => {
                this.pending--;
            });
    }

    message(e) {
        return e?.body?.message || e?.message || 'Unknown error';
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
