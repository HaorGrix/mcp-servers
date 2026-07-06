// Shared strict types for WordPress REST API responses and tool arguments

export interface WPError {
  code: string;
  message: string;
  data?: { status: number };
}

export interface WPPost {
  id: number;
  date: string;
  modified: string;
  slug: string;
  status: 'publish' | 'future' | 'draft' | 'pending' | 'private' | 'trash';
  type: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string; protected: boolean };
  excerpt: { rendered: string; protected: boolean };
  author: number;
  featured_media: number;
  categories: number[];
  tags: number[];
}

export interface WPPage {
  id: number;
  date: string;
  modified: string;
  slug: string;
  status: 'publish' | 'future' | 'draft' | 'pending' | 'private' | 'trash';
  type: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string; protected: boolean };
  excerpt: { rendered: string; protected: boolean };
  author: number;
  featured_media: number;
  parent: number;
  menu_order: number;
}

export interface WPMedia {
  id: number;
  date: string;
  slug: string;
  type: string;
  link: string;
  title: { rendered: string };
  author: number;
  caption: { rendered: string };
  alt_text: string;
  media_type: string;
  mime_type: string;
  source_url: string;
  media_details: Record<string, unknown>;
}

export interface WPUser {
  id: number;
  name: string;
  url: string;
  description: string;
  link: string;
  slug: string;
  email?: string;
  roles?: string[];
  registered_date?: string;
}

export interface WPComment {
  id: number;
  post: number;
  parent: number;
  author: number;
  author_name: string;
  author_email: string;
  author_url: string;
  date: string;
  content: { rendered: string };
  link: string;
  status: 'approved' | 'hold' | 'spam' | 'trash';
  type: string;
}

export interface WPTerm {
  id: number;
  count: number;
  description: string;
  link: string;
  name: string;
  slug: string;
  taxonomy: string;
  parent: number;
}

export interface WPPostType {
  name: string;
  label: string;
  slug: string;
  rest_base: string;
  rest_namespace: string;
  hierarchical: boolean;
}

export interface WCProduct {
  id: number;
  name: string;
  slug: string;
  status: string;
  type: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_quantity: number | null;
  stock_status: string;
  categories: Array<{ id: number; name: string; slug: string }>;
  images: Array<{ id: number; src: string; alt: string }>;
  description: string;
  short_description: string;
}

export interface WCOrder {
  id: number;
  status: string;
  currency: string;
  total: string;
  subtotal: string;
  customer_id: number;
  billing: WCAddress;
  shipping: WCAddress;
  line_items: WCLineItem[];
  date_created: string;
  date_modified: string;
}

export interface WCAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

export interface WCLineItem {
  id: number;
  name: string;
  product_id: number;
  quantity: number;
  total: string;
}

export interface WCCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  date_created: string;
  orders_count: number;
  total_spent: string;
}
