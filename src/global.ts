// Сборка для сайтов без сборщика: <script src="semetrics.min.js"></script> → window.Semetrics
import * as Semetrics from "./index";

(window as unknown as { Semetrics: typeof Semetrics }).Semetrics = Semetrics;
