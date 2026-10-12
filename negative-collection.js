(function (root) {
  "use strict";

  function normalize(value) {
    if (value === true || value === "yes") return "yes";
    if (value === false || value === "no") return "no";
    if (typeof value === "string") {
      const choice = value.trim().toLowerCase();
      if (choice === "yes" || choice === "no") return choice;
    }
    return null;
  }

  function deliveryCopy(value) {
    const choice = normalize(value);
    if (choice === "yes") return {
      title:"YOUR NEGATIVES ARE WAITING",
      body:"We\u2019ll keep them safe at the lab for 7 days from the day this link lands in your inbox. Swing by with your order number whenever you\u2019re ready. Need us to keep them a little longer? Just let us know."
    };
    if (choice === "no") return {
      title:"ALL YOURS, RIGHT HERE.",
      body:"You chose not to collect the negatives for this order, so you're all good for now! Hope to see you back at the lab again soon!"
    };
    return null;
  }

  function message(value) {
    const copy = deliveryCopy(value);
    return copy ? copy.body : "";
  }

  root.SaujanaNegativeCollection = Object.freeze({normalize, message, deliveryCopy});
}(typeof window === "undefined" ? globalThis : window));
