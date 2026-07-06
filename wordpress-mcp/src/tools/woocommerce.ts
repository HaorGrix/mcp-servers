import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { WCProduct, WCOrder, WCCustomer } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerWooCommerceTools(server: McpServer, client: WordPressClient): void {
  // ── Products ──────────────────────────────────────────────────────────────
  server.tool(
    'wc_list_products',
    'List WooCommerce products',
    {
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      status: z.enum(['draft', 'pending', 'private', 'publish', 'any']).optional().default('publish'),
      type: z.enum(['simple', 'grouped', 'external', 'variable']).optional(),
      category: z.string().optional().describe('Filter by category slug or ID'),
      search: z.string().optional(),
      orderby: z.enum(['date', 'id', 'title', 'price', 'popularity', 'rating']).optional().default('date'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
      stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        status: args.status,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.type) params['type'] = args.type;
      if (args.category) params['category'] = args.category;
      if (args.search) params['search'] = args.search;
      if (args.stock_status) params['stock_status'] = args.stock_status;

      const products = await client.wcGet<WCProduct[]>('/products', params);
      return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
    },
  );

  server.tool(
    'wc_get_product',
    'Get a single WooCommerce product by ID',
    { id: z.number().int() },
    async ({ id }) => {
      const product = await client.wcGet<WCProduct>(`/products/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(product, null, 2) }] };
    },
  );

  server.tool(
    'wc_create_product',
    'Create a new WooCommerce product',
    {
      name: z.string().min(1),
      type: z.enum(['simple', 'grouped', 'external', 'variable']).optional().default('simple'),
      status: z.enum(['draft', 'pending', 'private', 'publish']).optional().default('draft'),
      description: z.string().optional(),
      short_description: z.string().optional(),
      regular_price: z.string().optional().describe('Regular price as string e.g. "29.99"'),
      sale_price: z.string().optional(),
      sku: z.string().optional(),
      manage_stock: z.boolean().optional().default(false),
      stock_quantity: z.number().int().optional(),
      stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional().default('instock'),
      categories: z.array(z.object({ id: z.number().int() })).optional(),
    },
    async (args) => {
      const body: Record<string, unknown> = {
        name: args.name,
        type: args.type,
        status: args.status,
        manage_stock: args.manage_stock,
        stock_status: args.stock_status,
      };
      if (args.description) body['description'] = args.description;
      if (args.short_description) body['short_description'] = args.short_description;
      if (args.regular_price) body['regular_price'] = args.regular_price;
      if (args.sale_price) body['sale_price'] = args.sale_price;
      if (args.sku) body['sku'] = args.sku;
      if (args.stock_quantity !== undefined) body['stock_quantity'] = args.stock_quantity;
      if (args.categories) body['categories'] = args.categories;

      const product = await client.wcPost<WCProduct>('/products', body);
      return { content: [{ type: 'text', text: JSON.stringify(product, null, 2) }] };
    },
  );

  server.tool(
    'wc_update_product',
    'Update a WooCommerce product',
    {
      id: z.number().int(),
      name: z.string().optional(),
      status: z.enum(['draft', 'pending', 'private', 'publish']).optional(),
      description: z.string().optional(),
      short_description: z.string().optional(),
      regular_price: z.string().optional(),
      sale_price: z.string().optional(),
      sku: z.string().optional(),
      stock_quantity: z.number().int().optional(),
      stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
      categories: z.array(z.object({ id: z.number().int() })).optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const product = await client.wcPut<WCProduct>(`/products/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(product, null, 2) }] };
    },
  );

  server.tool(
    'wc_delete_product',
    'Delete a WooCommerce product',
    {
      id: z.number().int(),
      force: z.boolean().optional().default(true).describe('Must be true for WooCommerce products'),
    },
    async ({ id, force }) => {
      const result = await client.wcDelete<WCProduct>(`/products/${id}`, force);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── Orders ────────────────────────────────────────────────────────────────
  server.tool(
    'wc_list_orders',
    'List WooCommerce orders',
    {
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      status: z
        .enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'any'])
        .optional()
        .default('any'),
      customer: z.number().int().optional().describe('Filter by customer user ID'),
      orderby: z.enum(['date', 'id', 'total']).optional().default('date'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        status: args.status,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.customer) params['customer'] = args.customer;

      const orders = await client.wcGet<WCOrder[]>('/orders', params);
      return { content: [{ type: 'text', text: JSON.stringify(orders, null, 2) }] };
    },
  );

  server.tool(
    'wc_get_order',
    'Get a single WooCommerce order by ID',
    { id: z.number().int() },
    async ({ id }) => {
      const order = await client.wcGet<WCOrder>(`/orders/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(order, null, 2) }] };
    },
  );

  server.tool(
    'wc_update_order',
    'Update order status or billing/shipping details',
    {
      id: z.number().int(),
      status: z
        .enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'])
        .optional(),
      customer_note: z.string().optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const order = await client.wcPut<WCOrder>(`/orders/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(order, null, 2) }] };
    },
  );

  // ── Customers ─────────────────────────────────────────────────────────────
  server.tool(
    'wc_list_customers',
    'List WooCommerce customers',
    {
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      search: z.string().optional(),
      orderby: z.enum(['id', 'name', 'registered_date']).optional().default('registered_date'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        orderby: args.orderby,
        order: args.order,
        role: 'customer',
      };
      if (args.search) params['search'] = args.search;

      const customers = await client.wcGet<WCCustomer[]>('/customers', params);
      return { content: [{ type: 'text', text: JSON.stringify(customers, null, 2) }] };
    },
  );

  server.tool(
    'wc_get_customer',
    'Get a single WooCommerce customer by ID',
    { id: z.number().int() },
    async ({ id }) => {
      const customer = await client.wcGet<WCCustomer>(`/customers/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }] };
    },
  );
}
