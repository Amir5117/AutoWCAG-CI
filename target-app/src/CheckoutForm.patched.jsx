function CheckoutForm() {
  return <form className="checkout-form">
      <h1>Checkout</h1>

      <img src="/vite.svg" width="48" height="48" alt="Vite logo" />

      <div className="field">
        <label htmlFor="cardNumber" className="field-caption">Card number</label>
        <input type="text" name="cardNumber" id="cardNumber" />
      </div>

      <div className="field">
        <label htmlFor="expiry">Expiry date</label>
        <input type="text" id="expiry" name="expiry" placeholder="MM/YY" />
      </div>

      <button type="button" aria-label="Remove">
        <span aria-hidden="true">&#10005;</span>
      </button>

      <button type="submit">Pay now</button>
    </form>;
}
export default CheckoutForm;