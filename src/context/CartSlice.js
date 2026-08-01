import { createSlice } from "@reduxjs/toolkit";

const cartSlice = createSlice({
  name: "cart",
  initialState: {
    cartItems: [],
  },

  reducers: {
    setCart: (state, action) => {
      state.cartItems = action.payload;
    },

    addCart: (state, action) => {
      const item = action.payload;

      const existingItem = state.cartItems.find((x) => x.id === item.id);

      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        state.cartItems.push({ ...item, quantity: 1 });
      }
    },

    removeCart: (state, action) => {
      const itemID = action.payload;

      const existingItem = state.cartItems.find((x) => x.id === itemID);

      if (existingItem.quantity > 1) {
        existingItem.quantity -= 1;
      } else {
        state.cartItems = state.cartItems.filter((item) => item.id !== itemID);
      }
    },

    // Remove an item entirely, regardless of quantity.
    deleteCart: (state, action) => {
      state.cartItems = state.cartItems.filter(
        (item) => item.id !== action.payload,
      );
    },

    clearCart: (state) => {
      state.cartItems = [];
    },
  },
});

export const { addCart, removeCart, deleteCart, clearCart, setCart } =
  cartSlice.actions;
export default cartSlice.reducer;
