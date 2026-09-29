// Shared look for the sign-in, setup and invite cards (plain module so server and client components can both use it).
// Below lg the form sits in a raised card; from lg it opens up onto the page beside the brand showcase.
export const authCard =
  "shadow-xl shadow-brand/[0.08] ring-foreground/[0.08] [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(7)] dark:shadow-black/40 lg:gap-8 lg:overflow-visible lg:bg-transparent lg:shadow-none lg:[--card-spacing:--spacing(0)]";
export const authTitle = "text-xl font-semibold tracking-tight sm:text-2xl lg:text-3xl lg:tracking-[-0.025em]";
/** Sub-line under the title: a notch larger than the card default. */
export const authLead = "text-ui sm:text-body";
