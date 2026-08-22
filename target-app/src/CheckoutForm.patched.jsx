// Dummy checkout component for AutoWCAG-CI Phase 1.
// Intentionally contains 3 structural WCAG 2.1 AA violations for the scanner to detect:
//   1. <img> with no alt text            -> axe rule: image-alt
//   2. Icon-only <button> with no label  -> axe rule: button-name
//   3. <input> with no associated label  -> axe rule: label
// Dummy checkout component for AutoWCAG-CI Phase 1.
// Intentionally contains 3 structural WCAG 2.1 AA violations for the scanner to detect:
//   1. <img> with no alt text            -> axe rule: image-alt
//   2. Icon-only <button> with no label  -> axe rule: button-name
//   3. <input> with no associated label  -> axe rule: label
function CheckoutForm() {
  return <form className="checkout-form">
      <h1>Checkout</h1>

      {/* Fixed: added alt attribute */}
      <img src="/vite.svg" width="48" height="48" alt="Vite logo" />

      <div className="field">
        {/* Fixed: replaced span with label linked to input */}
        <label htmlFor="cardNumber" className="field-caption">Card number</label>
        <input type="text" name="cardNumber" id="cardNumber" />
      </div>

      <div className="field">
        <label htmlFor="expiry">Expiry date</label>
        <input type="text" id="expiry" name="expiry" placeholder="MM/YY" />
      </div>

      {/* Fixed: added accessible name via aria-label */}
      <button type="button" aria-label="Remove">
        <span aria-hidden="true">&#10005;</span>
      </button>

      <button type="submit">Pay now</button>
    </form>;
}
export default CheckoutForm;