// midnight today in IST, as a SQL expression
export const DAY_START =
  "(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')";
  