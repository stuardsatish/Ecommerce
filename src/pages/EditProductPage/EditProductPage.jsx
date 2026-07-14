import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { fireDB, storage } from "../../context/FirebaseConfig";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

const EditProductPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [product, setProduct] = useState({
    title: "",
    price: "",
    discount: "",
    discountExpiry: "",
    stock: "",
    category: "",
    thumbnail: "",
    gallery: [],
    productId: "", // For storage folder
  });

  const [thumbFile, setThumbFile] = useState(null);
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // Fetch product

  const getProduct = async () => {
    const docRef = doc(fireDB, "products", id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      setProduct({
        ...data,
        thumbnail: data.thumbnail || data.image || "",
        gallery: data.gallery || [],
        productId: data.productId || id, // fallback to doc id
        discountExpiry: data.discountExpiry || "",
      });
    }
  };

  useEffect(() => {
    getProduct();
  }, []); // Handle input change

  const handleChange = (e) => {
    const { name, value } = e.target;

    setProduct({
      ...product,
      [name]: value,
    });
  }; // Handle Thumbnail Change

  const handleThumbChange = (e) => {
    const file = e.target.files[0];
    if (file) setThumbFile(file);
  }; // Handle Gallery Change (Adding new images)

  const handleGalleryChange = (e) => {
    setGalleryFiles([...e.target.files]);
  }; // Remove individual image from gallery

  const removeGalleryImage = async (imageUrl) => {
    if (!window.confirm("Remove this image?")) return;
    try {
      setLoading(true);
      const productRef = doc(fireDB, "products", id); // 1. Remove from Firestore
      await updateDoc(productRef, {
        gallery: arrayRemove(imageUrl),
      }); // 2. Try to delete from Storage if it matches our pattern (optional but recommended)

      try {
        // Only attempt deletion if it's a firebase storage URL we recognize
        if (imageUrl.includes("firebasestorage.googleapis.com")) {
          const storageRef = ref(storage, imageUrl);
          await deleteObject(storageRef);
        }
      } catch (e) {
        console.log("Storage delete skipped/failed:", e);
      } // 3. Update local state

      setProduct((prev) => ({
        ...prev,
        gallery: prev.gallery.filter((img) => img !== imageUrl),
      }));

      alert("Image removed");
    } catch (error) {
      console.error(error);
      alert("Failed to remove image");
    } finally {
      setLoading(false);
    }
  }; // Update product

  const updateProduct = async () => {
    try {
      setLoading(true);
      setUploadProgress(0);
      const productRef = doc(fireDB, "products", id);
      const prodId = product.productId || id;

      let newThumbnail = product.thumbnail; // 1. Upload new Thumbnail if selected

      if (thumbFile) {
        const thumbRef = ref(
          storage,
          `products/${prodId}/thumbnail/${thumbFile.name}`,
        );
        await uploadBytes(thumbRef, thumbFile);
        newThumbnail = await getDownloadURL(thumbRef);
        setUploadProgress(30);
      } // 2. Upload new Gallery images if selected

      const newGalleryUrls = [];
      if (galleryFiles.length > 0) {
        for (let i = 0; i < galleryFiles.length; i++) {
          const file = galleryFiles[i];
          const fileRef = ref(
            storage,
            `products/${prodId}/gallery/${file.name}`,
          );
          await uploadBytes(fileRef, file);
          const url = await getDownloadURL(fileRef);
          newGalleryUrls.push(url);
          setUploadProgress(30 + ((i + 1) / galleryFiles.length) * 60);
        }
      } // 3. Update Firestore

      await updateDoc(productRef, {
        title: product.title,
        price: Math.max(0, Number(product.price) || 0),
        discount: Math.max(0, Number(product.discount) || 0),
        discountExpiry: product.discountExpiry || "",
        stock: Math.max(0, Number(product.stock) || 0),
        category: product.category,
        description: product.description || "",
        thumbnail: newThumbnail,
        gallery: arrayUnion(...newGalleryUrls),
      });

      // Update the same product in every user's cart
      const cartsSnapshot = await getDocs(collection(fireDB, "carts"));

      for (const cartDoc of cartsSnapshot.docs) {
        const cartData = cartDoc.data();

        if (!cartData.items || !Array.isArray(cartData.items)) continue;

        let changed = false;

        const updatedItems = cartData.items.map((item) => {
          if (item.productId === id) {
            changed = true;

            return {
              ...item,
              title: product.title,
              price: Math.max(0, Number(product.price) || 0),
              discount: Math.max(0, Number(product.discount) || 0),
              discountExpiry: product.discountExpiry || "",
              stock: Math.max(0, Number(product.stock) || 0),
              category: product.category,
              image: newThumbnail,
            };
          }

          return item;
        });

        if (changed) {
          await updateDoc(cartDoc.ref, {
            items: updatedItems,
          });
        }
      }

      setLoading(false);
      alert("Product Updated Successfully");
      navigate("/admin/add-product");
    } catch (error) {
      console.error(error);
      setLoading(false);
      alert("Update failed");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fb",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "40px",
      }}
    >
           {" "}
      <div
        style={{
          width: "600px",
          background: "#fff",
          padding: "35px",
          borderRadius: "12px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
        }}
      >
               {" "}
        <h2
          style={{
            marginBottom: "25px",
            fontWeight: "600",
            fontSize: "24px",
          }}
        >
                    Edit Product        {" "}
        </h2>
                {/* Thumbnail Preview & Change */}       {" "}
        <div style={{ marginBottom: "20px" }}>
                     {" "}
          <label
            style={{ fontWeight: "500", display: "block", marginBottom: "8px" }}
          >
            Main Thumbnail
          </label>
                     {" "}
          <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                           {" "}
            {product.thumbnail && (
              <img
                src={product.thumbnail}
                alt="Thumbnail"
                style={{
                  width: "80px",
                  height: "80px",
                  objectFit: "cover",
                  borderRadius: "8px",
                  border: "1px solid #ddd",
                }}
              />
            )}
                           {" "}
            <input
              type="file"
              accept="image/*"
              onChange={handleThumbChange}
              style={{ flex: 1 }}
            />
                       {" "}
          </div>
                 {" "}
        </div>
                {/* Gallery Preview & Management */}       {" "}
        <div style={{ marginBottom: "20px" }}>
                     {" "}
          <label
            style={{ fontWeight: "500", display: "block", marginBottom: "8px" }}
          >
            Gallery Images
          </label>
                     {" "}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
                           {" "}
            {product.gallery?.map((img, index) => (
              <div key={index} style={{ position: "relative" }}>
                                       {" "}
                <img
                  src={img}
                  alt={`Gallery ₹{index}`}
                  style={{
                    width: "70px",
                    height: "70px",
                    objectFit: "cover",
                    borderRadius: "6px",
                    border: "1px solid #eee",
                  }}
                />
                                       {" "}
                <button
                  onClick={() => removeGalleryImage(img)}
                  style={{
                    position: "absolute",
                    top: "-5px",
                    right: "-5px",
                    background: "#ef4444",
                    color: "white",
                    border: "none",
                    borderRadius: "50%",
                    width: "20px",
                    height: "20px",
                    cursor: "pointer",
                    fontSize: "12px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  }}
                >
                                              ✕                        {" "}
                </button>
                                   {" "}
              </div>
            ))}
                       {" "}
          </div>
                     {" "}
          <label style={{ fontSize: "13px", color: "#666" }}>
            Add more images to gallery:
          </label>
                     {" "}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleGalleryChange}
            style={{ display: "block", marginTop: "5px" }}
          />
                 {" "}
        </div>
               {" "}
        {loading && uploadProgress > 0 && (
          <div
            style={{
              width: "100%",
              background: "#eee",
              borderRadius: "5px",
              height: "8px",
              marginBottom: "15px",
            }}
          >
                           {" "}
            <div
              style={{
                width: `${uploadProgress}%`,
                background: "#4f46e5",
                height: "100%",
                borderRadius: "5px",
                transition: "0.3s",
              }}
            />
                       {" "}
          </div>
        )}
                {/* Title */}       {" "}
        <label style={{ fontWeight: "500" }}>Title</label>       {" "}
        <input
          type="text"
          name="title"
          value={product.title}
          onChange={handleChange}
          placeholder="Product Title"
          style={inputStyle}
        />
                {/* Price */}       {" "}
        <label style={{ fontWeight: "500" }}>Price</label>       {" "}
        <input
          type="number"
          name="price"
          value={product.price}
          onChange={handleChange}
          placeholder="Product Price"
          style={inputStyle}
        />
        {/* Discount */}        {" "}
        <label style={{ fontWeight: "500" }}>Discount</label>        {" "}
        <input
          type="number"
          name="discount"
          value={product.discount}
          onChange={handleChange}
          placeholder="Product Discount"
          style={inputStyle}
        />
        {/* Discount Expiry */}        {" "}
        <label style={{ fontWeight: "500" }}>Discount Expiry Date & Time</label>        {" "}
        <input
          type="datetime-local"
          name="discountExpiry"
          value={product.discountExpiry || ""}
          onChange={handleChange}
          style={inputStyle}
        />
                {/* Stock */}       {" "}
        <label style={{ fontWeight: "500" }}>Stock</label>       {" "}
        <input
          type="number"
          name="stock"
          value={product.stock}
          onChange={handleChange}
          placeholder="Available Stock"
          style={inputStyle}
        />
                {/* Category */}       {" "}
        <label style={{ fontWeight: "500" }}>Category</label>       {" "}
        <input
          type="text"
          name="category"
          value={product.category}
          onChange={handleChange}
          placeholder="Product Category"
          style={inputStyle}
        />
                {/* Buttons */}       {" "}
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginTop: "25px",
          }}
        >
                   {" "}
          <button
            onClick={updateProduct}
            style={{
              flex: 1,
              padding: "12px",
              background: "#4f46e5",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
                        {loading ? "Updating..." : "Update Product"}       
             {" "}
          </button>
                   {" "}
          <button
            onClick={() => navigate("/admin/add-product")}
            style={{
              flex: 1,
              padding: "12px",
              background: "#E4E2E1",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
                        Cancel          {" "}
          </button>
                 {" "}
        </div>
             {" "}
      </div>
         {" "}
    </div>
  );
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  marginTop: "6px",
  marginBottom: "16px",
  borderRadius: "6px",
  border: "1px solid #ddd",
  fontSize: "14px",
};

export default EditProductPage;
