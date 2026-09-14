import type { Register } from "../context.js";
import { registerOverview } from "./overview.js";
import { registerBusiness } from "./business.js";
import { registerPages } from "./pages.js";
import { registerMessenger } from "./messenger.js";
import { registerInstagram } from "./instagram.js";
import { registerWhatsApp } from "./whatsapp.js";
import { registerLeads } from "./leads.js";
import { registerCatalog } from "./catalog.js";
import { registerDeveloper } from "./developer.js";
import { registerAds } from "./ads.js";
import { registerThreads } from "./threads.js";

export const modules: Array<{ name: string; register: Register }> = [
  { name: "overview", register: registerOverview },
  { name: "business", register: registerBusiness },
  { name: "pages", register: registerPages },
  { name: "messenger", register: registerMessenger },
  { name: "instagram", register: registerInstagram },
  { name: "whatsapp", register: registerWhatsApp },
  { name: "leads", register: registerLeads },
  { name: "catalog", register: registerCatalog },
  { name: "developer", register: registerDeveloper },
  { name: "ads", register: registerAds },
  { name: "threads", register: registerThreads },
];
