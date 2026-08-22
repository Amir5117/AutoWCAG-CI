// Dummy checkout component for AutoWCAG-CI Phase 1.
// Intentionally contains 3 structural WCAG 2.1 AA violations for the scanner to detect:
//   1. <img> with no alt text            -> axe rule: image-alt
//   2. Icon-only <button> with no label  -> axe rule: button-name
//   3. <input> with no associated label  -> axe rule: label
function CheckoutForm() {
  return (
    <form className="checkout-form">
      <h1>Checkout</h1>

      {/* Violation 1: missing alt attribute on a meaningful image */}
      <img src="/vite.svg" width="48" height="48" />

      <div className="field">
        {/* Violation 3: no <label htmlFor>, no aria-label, no aria-labelledby, no placeholder */}
        <span className="field-caption">Card number</span>
        <input type="text" name="cardNumber" />
      </div>

      <div className="field">
        <label htmlFor="expiry">Expiry date</label>
        <input type="text" id="expiry" name="expiry" placeholder="MM/YY" />
      </div>

      {/* Violation 2: icon-only button with no accessible name */}
      <button type="button">
        <span aria-hidden="true">&#10005;</span>
      </button>

      <button type="submit">Pay now</button>
    </form>
  );
}

export default CheckoutForm;
