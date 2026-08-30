const express = require("express");
const router = express.Router();
const BillService = require("./bills.service");
const prisma = require("../../prisma");
const crypto = require("crypto");
// تهريب HTML — لازم لأي داتا جاية من المستخدم بتتحط في الصفحة
// من غيرها اسم فيه & أو < بيخرب الفاتورة
const escapeHtml = (str) =>
  String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
router.post("/", async (req, res) => {
  try {
    const bill = await BillService.createBill(req.body);
    res.status(201).json(bill);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await BillService.getAllBills(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const updated = await BillService.updateBillStatus(req.params.id, req.body.status);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔥 راوت إرسال الإيميل
router.post("/:id/send", async (req, res) => {
  try {
    const { email } = req.body;
    await BillService.sendBillEmail(req.params.id, email);
    res.json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("❌ EMAIL ERROR DETAILS:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/pdf", async (req, res) => {
  try {
    // 🔒 التحقق من التوقيع وصلاحية اللينك
    const { exp, sig } = req.query;
    if (!exp || !sig) return res.status(401).send("Invalid link");
    if (Date.now() > parseInt(exp))
      return res.status(410).send("This link has expired. Please generate a new one from Discord.");

    const expected = crypto
      .createHmac("sha256", process.env.PDF_LINK_SECRET)
      .update(`${req.params.id}.${exp}`)
      .digest("hex");

    const sigBuf = Buffer.from(String(sig));
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return res.status(401).send("Invalid link");
    }

    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: { createdBy: { select: { name: true } } },
    });

    if (!bill) {
      console.error(`❌ PDF Error: Bill with ID ${req.params.id} not found.`);
      return res.status(404).send("Bill not found");
    }

    const issueDateEn = new Date(bill.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const issueDateAr = new Date(bill.createdAt).toLocaleDateString("ar-EG-u-nu-latn", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const grossAmount = bill.amount * bill.quantity;
    const issuedBy = bill.issuedByName || bill.createdBy?.name || "System";

    // 🔄 بيقلب "Camp / مخيم" لـ "مخيم / Camp" وقت العرض (لو العربي مش الأول أصلًا)
    const arFirst = (str) => {
      if (!str || !str.includes("/")) return str || "";
      const parts = str.split("/").map((s) => s.trim());
      return /[\u0600-\u06FF]/.test(parts[0]) ? str : `${parts[1]} / ${parts[0]}`;
    };

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #2d3748; padding: 20px; background-color: #ffffff; }
            .container { max-width: 800px; margin: 0 auto; background: #ffffff; padding: 40px; border: 2px solid #2d3748; border-radius: 8px; }
            .header { border: 1px solid #2d3748; color: #2d3748; padding: 20px; text-align: center; border-radius: 8px; margin: 25px 0 30px; }
            .header h1 { margin: 0; font-size: 26px; letter-spacing: 1px; }
            .header p { margin: 6px 0 0 0; font-size: 15px; }
            .details { margin-bottom: 25px; line-height: 1.9; font-size: 15px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #f1f5f9 !important; padding: 12px; border: 1px solid #2d3748; color: #2d3748; }
            td { padding: 15px 12px; border: 1px solid #2d3748; text-align: center; }
            .total { margin-top: 30px; padding-top: 20px; border-top: 2px solid #2d3748; }
            .total p { margin: 5px 0; font-size: 16px; }
            .total h2 { margin: 10px 0 0 0; font-size: 24px; color: #2d3748; }
            @media print {
              body { padding: 0; }
              .container { margin: 0; max-width: 100%; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              @page { margin: 0; size: auto; }
              body { padding: 15mm !important; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>كودينج هـب | <span dir="ltr">CODING HUB</span></h1>
              <p>فاتورة رسمية / <span dir="ltr">Official Invoice</span></p>
            </div>
            
            <div class="details">
              <p><strong>الاسم / <span dir="ltr">Name</span>:</strong> ${escapeHtml(bill.name)}</p>
              <p><strong>رقم الفاتورة / <span dir="ltr">Invoice No</span>:</strong> <span dir="ltr">INV-${escapeHtml(bill.referenceId)}</span></p>
              <p><strong>تاريخ الإصدار / <span dir="ltr">Date</span>:</strong> ${escapeHtml(issueDateAr)} / <span dir="ltr">${escapeHtml(issueDateEn)}</span></p>
              <p><strong>أنشأها / <span dir="ltr">Issued By</span>:</strong> ${escapeHtml(issuedBy)}</p>
            </div>

            <table>
              <tr>
                <th>البيان<br><span dir="ltr">Description</span></th>
                <th>سعر الوحدة<br><span dir="ltr">Unit Price</span></th>
                <th>الكمية<br><span dir="ltr">Qty</span></th>
                <th>الإجمالي<br><span dir="ltr">Gross</span></th>
              </tr>
              <tr>
                <td><strong>${escapeHtml(arFirst(bill.activityType))}</strong>${bill.description ? `<br><span dir="ltr" style="color: #718096; font-size: 14px;">${escapeHtml(bill.description)}</span>` : ""}</td>
                <td><span dir="ltr"> QAR ${escapeHtml(bill.amount)}</span></td>
                <td>${escapeHtml(bill.quantity)}</td>
                <td><span dir="ltr"> QAR ${escapeHtml(grossAmount)}</span></td>
              </tr>
            </table>

            <div class="total">
              ${bill.discount > 0 ? `<p>الخصم / <span dir="ltr">Discount</span>: <strong>${escapeHtml(bill.discount)}%</strong></p>` : ""}
              <h2>الصافي المستحق / <span dir="ltr">Net Total</span>: <span dir="ltr">${escapeHtml(bill.netAmount)} QAR</span></h2>
            </div>
          </div>
          <script>
            setTimeout(() => { window.print(); }, 300);
          </script> 
        </body>
      </html>`;
    res.send(html);
  } catch (error) {
    console.error("❌ PDF GENERATION ERROR:", error);
    res.status(500).send("Error generating PDF: " + error.message);
  }
});

module.exports = router;
