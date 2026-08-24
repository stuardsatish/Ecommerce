import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { supabase } from "../../context/SupabaseConfig";
import { mapProductRow } from "../../utils/supabaseProducts";
import { validateImageFile, validateImageFiles } from "../../utils/uploadValidation";

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
    gstRate: "0",
    hsnCode: "",
    thumbnail: "",
    gallery: [],
    productId: "", // For storage folder
  });

  const [thumbFile, setThumbFile] = useState(null);
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(0); // Fetch product

  const getProduct = async () => {
    const { data: row, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;

    if (row) {
      const data = mapProductRow(row);
      setProduct({
        ...data,
        thumbnail: data.thumbnail || data.image || "",
        gallery: data.gallery || [],
        productId: data.productId || id, // fallback to doc id
        discountExpiry: data.discountExpiry || "",
        gstRate: data.gstRate != null ? String(data.gstRate) : "0",
        hsnCode: data.hsnCode || "",
      });
    }
  };

  useEffect(() => {
    getProduct().catch((e) => console.error(e)).finally(() => setFetching(false));
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
    if (!file) return;
    const v = validateImageFile(file);
    if (!v.ok) { alert(v.error); e.target.value = ""; return; }
    setThumbFile(file);
  }; // Handle Gallery Change (Adding new images)

  const handleGalleryChange = (e) => {
    const files = [...e.target.files];
    const v = validateImageFiles(files);
    if (!v.ok) { alert(v.error); e.target.value = ""; return; }
    setGalleryFiles(files);
  }; // Remove individual image from gallery

  const removeGalleryImage = async (imageUrl) => {
    if (!window.confirm("Remove this image?")) return;
    try {
      setLoading(true);
      const newGallery = product.gallery.filter((img) => img !== imageUrl); // 1. Remove from the products row
      const { error: galleryUpdateErr } = await supabase
        .from("products")
        .update({ gallery: newGallery })
        .eq("id", id);
      if (galleryUpdateErr) throw galleryUpdateErr; // 2. Try to delete from Storage if it matches our pattern (optional but recommended)

      try {
        // Only attempt deletion if it is a Supabase Storage object we recognize (products bucket)
        const marker = "/storage/v1/object/public/products/";
        const idx = imageUrl.indexOf(marker);
        if (idx !== -1) {
          const objectPath = imageUrl.slice(idx + marker.length);
          await supabase.storage.from("products").remove([objectPath]);
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
      const prodId = product.productId || id;

      let newThumbnail = product.thumbnail; // 1. Upload new Thumbnail if selected

      if (thumbFile) {
        const thumbPath = `${prodId}/thumbnail/${thumbFile.name}`;
        const { error: thumbErr } = await supabase.storage
          .from("products")
          .upload(thumbPath, thumbFile, { upsert: true });
        if (thumbErr) throw thumbErr;
        newThumbnail = supabase.storage.from("products").getPublicUrl(thumbPath).data.publicUrl;
        setUploadProgress(30);
      } // 2. Upload new Gallery images if selected

      const newGalleryUrls = [];
      if (galleryFiles.length > 0) {
        for (let i = 0; i < galleryFiles.length; i++) {
          const file = galleryFiles[i];
          const galleryPath = `${prodId}/gallery/${file.name}`;
          const { error: galleryErr } = await supabase.storage
            .from("products")
            .upload(galleryPath, file, { upsert: true });
          if (galleryErr) throw galleryErr;
          const url = supabase.storage.from("products").getPublicUrl(galleryPath).data.publicUrl;
          newGalleryUrls.push(url);
          setUploadProgress(30 + ((i + 1) / galleryFiles.length) * 60);
        }
      } // 3. Update the products row

      const { error: updateErr } = await supabase
        .from("products")
        .update({
          title: product.title,
          price: Math.max(0, Number(product.price) || 0),
          discount: Math.max(0, Number(product.discount) || 0),
          discount_expiry: product.discountExpiry || null,
          stock: Math.max(0, Number(product.stock) || 0),
          category: product.category,
          gst_rate: Number(product.gstRate) || 0,
          hsn_code: product.hsnCode || "",
          price_type: "inclusive",
          description: product.description || "",
          thumbnail: newThumbnail,
          gallery: [...product.gallery, ...newGalleryUrls],
        })
        .eq("id", id);
      if (updateErr) throw updateErr;

      // Carts join products live at render/fetch time (see src/App.jsx), so
      // there's no snapshot to patch here the way the old Firestore carts
      // doc required.

      setLoading(false);
      alert("Product Updated Successfully");
      navigate("/admin/add-product");
    } catch (error) {
      console.error(error);
      setLoading(false);
      alert("Update failed");
    }
  };

  if (fetching) {
    const bar = (style) => <div aria-hidden="true" className="animate-pulse" style={{ background: "var(--color-surface-muted)", borderRadius: "6px", ...style }} />
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-surface-muted)", display: "flex", justifyContent: "center", alignItems: "center", padding: "40px" }} aria-busy="true">
        <div style={{ width: "600px", maxWidth: "100%", background: "var(--color-surface)", padding: "35px", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }}>
          {bar({ width: "180px", height: "28px", marginBottom: "25px" })}
          {/* Thumbnail */}
          <div style={{ marginBottom: "20px" }}>
            {bar({ width: "120px", height: "14px", marginBottom: "8px" })}
            <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
              {bar({ width: "80px", height: "80px", borderRadius: "8px" })}
              {bar({ height: "36px", flex: 1, borderRadius: "8px" })}
            </div>
          </div>
          {/* Gallery */}
          <div style={{ marginBottom: "20px" }}>
            {bar({ width: "120px", height: "14px", marginBottom: "8px" })}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {[...Array(4)].map((_, i) => <div key={i}>{bar({ width: "70px", height: "70px", borderRadius: "6px" })}</div>)}
            </div>
          </div>
          {/* Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {[...Array(6)].map((_, i) => (
              <div key={i}>{bar({ width: "90px", height: "13px", marginBottom: "6px" })}{bar({ width: "100%", height: "42px", borderRadius: "8px" })}</div>
            ))}
          </div>
          {bar({ width: "100%", height: "46px", borderRadius: "8px", marginTop: "24px" })}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-surface-muted)",
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
          background: "var(--color-surface)",
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
                {/* Thumbnail Preview & Change */}       {" "}
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
                  border: "1px solid var(--color-border)",
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
                {/* Gallery Preview & Management */}       {" "}
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
                    border: "1px solid var(--color-border)",
                  }}
                />
                                       {" "}
                <button
                  onClick={() => removeGalleryImage(img)}
                  style={{
                    position: "absolute",
                    top: "-5px",
                    right: "-5px",
                    background: "var(--color-error)",
                    color: "var(--color-inverse)",
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
          <label style={{ fontSize: "13px", color: "var(--color-muted)" }}>
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
              background: "var(--color-surface-muted)",
              borderRadius: "5px",
              height: "8px",
              marginBottom: "15px",
            }}
          >
                           {" "}
            <div
              style={{
                width: `${uploadProgress}%`,
                background: "var(--color-accent-strong)",
                height: "100%",
                borderRadius: "5px",
                transition: "0.3s",
              }}
            />
                       {" "}
          </div>
        )}
                {/* Title */}       {" "}
        <label style={{ fontWeight: "500" }}>Title</label>       {" "}
        <input
          type="text"
          name="title"
          value={product.title}
          onChange={handleChange}
          placeholder="Product Title"
          style={inputStyle}
        />
                {/* Price */}       {" "}
        <label style={{ fontWeight: "500" }}>Price</label>       {" "}
        <input
          type="number"
          name="price"
          value={product.price}
          onChange={handleChange}
          placeholder="Product Price"
          style={inputStyle}
        />
        {/* Discount */}        {" "}
        <label style={{ fontWeight: "500" }}>Discount</label>        {" "}
        <input
          type="number"
          name="discount"
          value={product.discount}
          onChange={handleChange}
          placeholder="Product Discount"
          style={inputStyle}
        />
        {/* Discount Expiry */}        {" "}
        <label style={{ fontWeight: "500" }}>Discount Expiry Date & Time</label>        {" "}
        <input
          type="datetime-local"
          name="discountExpiry"
          value={product.discountExpiry || ""}
          onChange={handleChange}
          style={inputStyle}
        />
                {/* Stock */}       {" "}
        <label style={{ fontWeight: "500" }}>Stock</label>       {" "}
        <input
          type="number"
          name="stock"
          value={product.stock}
          onChange={handleChange}
          placeholder="Available Stock"
          style={inputStyle}
        />
                {/* Category */}       {" "}
        <label style={{ fontWeight: "500" }}>Category</label>       {" "}
        <input
          type="text"
          name="category"
          value={product.category}
          onChange={handleChange}
          placeholder="Product Category"
          style={inputStyle}
        />
                {/* GST Rate */}
        <label style={{ fontWeight: "500" }}>GST Rate (%)</label>
        <select
          name="gstRate"
          value={product.gstRate}
          onChange={handleChange}
          style={inputStyle}
        >
          {["0", "5", "12", "18", "28"].map((r) => (
            <option key={r} value={r}>{r === "0" ? "0% (Exempt)" : `${r}%`}</option>
          ))}
        </select>
        {/* HSN Code */}
        <label style={{ fontWeight: "500" }}>HSN Code</label>
        <input
          type="text"
          name="hsnCode"
          value={product.hsnCode}
          onChange={handleChange}
          placeholder="e.g. 0207"
          style={inputStyle}
        />
        {/* Buttons */}       {" "}
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
              background: "var(--color-primary)",
              color: "var(--color-primary-fg)",
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
              background: "var(--color-border)",
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
  border: "1px solid var(--color-border)",
  fontSize: "14px",
};

export default EditProductPage;