import {
  BlocksIcon,
  ChartBarIcon,
  ChartColumnIcon,
  ChartSplineIcon,
  CircleDashedIcon,
  CoinsIcon,
  HandCoinsIcon,
  LayersIcon,
  ListOrderedIcon,
  MegaphoneIcon,
  ScaleIcon,
  SparklesIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "kpi.revenue": CoinsIcon,
  "kpi.spend": MegaphoneIcon,
  "kpi.roas": TrendingUpIcon,
  "kpi.mer": ScaleIcon,
  "kpi.leads": UserPlusIcon,
  "kpi.customers": HandCoinsIcon,
  "kpi.unattributed": CircleDashedIcon,
  "chart.explorer": ChartSplineIcon,
  "chart.spendRevenue": ChartColumnIcon,
  "chart.channels": ChartBarIcon,
  "list.topCampaigns": ListOrderedIcon,
  "list.wastedSpend": TriangleAlertIcon,
  "list.platforms": LayersIcon,
  "crm.recent": UsersIcon,
  "utility.insight": SparklesIcon,
};

export const widgetIcon = (type: string): LucideIcon => ICONS[type] ?? BlocksIcon;
