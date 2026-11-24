import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { publish, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CURRENCY from '@salesforce/i18n/currency';
import ORDER_CHANNEL from '@salesforce/messageChannel/OrderBuilder__c';
import ORDER_STATUS from '@salesforce/schema/Order.Status';
import getProducts from '@salesforce/apex/OrderBuilderController.getProducts';

const PAGE_SIZE = 100;

export default class AvailableProducts extends LightningElement {
    @api recordId;

    products = [];
    hasMore = true;
    isLoading = false;

    columns = [
        { label: 'Name', fieldName: 'name', wrapText: true },
        {
            label: 'List Price',
            fieldName: 'listPrice',
            type: 'currency',
            typeAttributes: { currencyCode: CURRENCY },
            cellAttributes: { alignment: 'left' }
        },
        {
            label: '',
            type: 'button-icon',
            fixedWidth: 50,
            typeAttributes: {
                name: 'add',
                iconName: 'utility:add',
                title: 'Add to order',
                alternativeText: 'Add to order',
                disabled: { fieldName: 'locked' }
            }
        }
    ];

    @wire(MessageContext) messageContext;
    @wire(getRecord, { recordId: '$recordId', fields: [ORDER_STATUS] }) order;

    get isLocked() {
        return !!this.order.data && getFieldValue(this.order.data, ORDER_STATUS) !== 'Draft';
    }

    get rows() {
        return this.products.map((p) => ({ ...p, locked: this.isLocked }));
    }

    connectedCallback() {
        this.loadMore();
    }

    async loadMore() {
        console.log('on load More 1');
        console.log('this.isLoading:::',this.isLoading);
        console.log('!this.hasMore:::',!this.hasMore);
        if (this.isLoading || !this.hasMore) {
            return;
        }
        this.isLoading = true;
        try {
            const last = this.products[this.products.length - 1];
            console.log('last:::',last);
            console.log('this.products.length:::',this.products.length);

            const page = await getProducts({
                lastName: last?.name,
                lastId: last?.id,
                pageSize: PAGE_SIZE
            });
            console.log('page:::',page);
            this.products = [
                ...this.products,
                ...page.map((pbe) => ({ id: pbe.Id, name: pbe.Product2.Name, listPrice: pbe.UnitPrice }))
            ];
            console.log('this.products:::',this.products);
            console.log('this.products.length:::',this.products.length);
            this.hasMore = page.length === PAGE_SIZE;
            console.log('this.hasMore:::',this.hasMore);
        } catch (e) {
            this.hasMore = false;
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not load products',
                    message: e?.body?.message || e?.message,
                    variant: 'error'
                })
            );
        } finally {
            this.isLoading = false;
        }
    }

    handleRowAction(event) {
        if (event.detail.action.name === 'add') {
            publish(this.messageContext, ORDER_CHANNEL, { pricebookEntryId: event.detail.row.id });
        }
    }
}
