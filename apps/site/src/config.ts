// Where things live (set per environment in .env.production; local development defaults).
export const APP_URL = (import.meta.env.VITE_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const WIDGET_URL = (import.meta.env.VITE_WIDGET_URL ?? 'http://localhost:5174').replace(/\/$/, '');
export const WIDGET_ACCOUNT = import.meta.env.VITE_WIDGET_ACCOUNT ?? 'acc_demo';
