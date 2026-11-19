// Entry point: load the app shell, then every screen, then start.
import { start } from "./app.js";
import "./views/home.js";
import "./views/sales.js";
import "./views/bills.js";
import "./views/bank.js";
import "./views/products.js";
import "./views/gst.js";
import "./views/reports.js";
import "./views/setup.js";
start();
