// In-house chart kit for PDF reports, drawn with react-pdf <Svg> primitives (Recharts can't
// render on the server). The web dashboard and the PDFs read the same ReportData, so the
// numbers are identical; only the drawing differs.
export { BarChart, HBarChart, type BarSeries } from "./bars";
export { Bullet } from "./bullet";
export { ComboChart } from "./combo";
export { Donut } from "./donut";
export { Funnel } from "./funnel";
export { Heatmap, heatColor } from "./heatmap";
export { LineChart, type LineSeries } from "./line";
export { SlopeChart, spread, type SlopeItem } from "./slope";
export { Sparkline } from "./sparkline";
export { Waterfall, type WaterfallStep } from "./waterfall";
export * from "./scale";
