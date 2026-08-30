const prisma = require("../../prisma");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
// تهريب HTML — لأي داتا جاية من المستخدم بتتحط في الإيميل
const escapeHtml = (str) =>
  String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
const BillService = {
  async createBill(data) {
    const amount = parseFloat(data.amount);
    const quantity = parseInt(data.quantity) || 1;
    const discount = parseInt(data.discount) || 0;
    const grossAmount = amount * quantity;
    const discountAmount = (discount / 100) * grossAmount;
    const netAmount = grossAmount - discountAmount;
    return await prisma.bill.create({
      data: {
        name: data.name,
        activityType: data.activityType,
        description: data.description || "",
        amount: amount,
        quantity: quantity,
        discount: discount,
        netAmount: netAmount,
        status: data.status || "PENDING",
        createdById: data.createdById,
        issuedByName: data.issuedByName || null,
      },
    });
  },
  // 🌟 تحديث دالة جلب الفواتير لتدعم البحث وحساب الإجمالي
  async getAllBills(filters = {}) {
    const { invoiceNo, month, year, startDate, endDate } = filters;
    let where = {};

    // 1. الفلترة برقم الفاتورة
    if (invoiceNo) {
      // بنشيل كلمة INV- لو المستخدم كتبها عشان نبحث بالرقم بس
      where.referenceId = parseInt(invoiceNo.replace(/INV-/i, ""));
    }

    // 2. الفلترة برينج تواريخ
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + "T23:59:59.999Z"), // نهاية اليوم
      };
    }
    // 3. الفلترة بالشهر
    else if (month) {
      const queryYear = year ? parseInt(year) : new Date().getFullYear(); // لو محطش سنة، نعتبرها السنة الحالية
      const queryMonth = parseInt(month);
      const start = new Date(queryYear, queryMonth - 1, 1);
      const end = new Date(queryYear, queryMonth, 0, 23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const bills = await prisma.bill.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });

    // 🌟 حساب الإجمالي لكل الفواتير اللي ظهرت في البحث
    const totalAmount = bills.reduce((sum, bill) => sum + bill.netAmount, 0);

    return { bills, totalAmount };
  },

  async updateBillStatus(id, status) {
    return await prisma.bill.update({ where: { id }, data: { status } });
  },

  async deleteBill(id) {
    return await prisma.bill.delete({ where: { id } });
  },
  // استبدل دالة sendBillEmail في ملف bills.service.js بالكامل بده:
  async sendBillEmail(billId, clientEmail) {
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { createdBy: { select: { name: true } } },
    });
    if (!bill) throw new Error("Bill not found");

    const issueDate = new Date(bill.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const issueTime = new Date(bill.createdAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const grossAmount = bill.amount * bill.quantity;
    const arFirst = (str) => {
      if (!str || !str.includes("/")) return str || "";
      const parts = str.split("/").map((s) => s.trim());
      return /[\u0600-\u06FF]/.test(parts[0]) ? str : `${parts[1]} / ${parts[0]}`;
    };
    const descriptionHtml = bill.description
      ? `<br><span dir="ltr" style="font-size: 13px; color: #718096;">${escapeHtml(bill.description)}</span>`
      : "";
    const discountHtml =
      bill.discount > 0
        ? `<p style="margin: 5px 0; color: #4a5568;">الخصم / Discount: <strong>${escapeHtml(bill.discount)}%</strong></p>`
        : "";

    const { data, error } = await resend.emails.send({
      from: "Coding Hub <onboarding@resend.dev>",
      to: clientEmail,
      subject: `Invoice INV-${bill.referenceId} from Coding Hub`,
      html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #1a202c; color: white; padding: 20px; text-align: center;">
        <h2 style="margin: 0; font-size: 24px;">CODING HUB | غودينغ هاب</h2>
        <p style="color: #a0aec0; margin: 5px 0 0 0;">فاتورة رسمية / OFFICIAL INVOICE</p>
      </div>
      <div style="padding: 20px; background-color: #f7fafc;">
        <p><strong>Invoice To / العميل:</strong> ${escapeHtml(bill.name)}</p>
        <p><strong>Invoice No / رقم الفاتورة:</strong> INV-${escapeHtml(bill.referenceId)}</p>
        <p><strong>Date & Time / التاريخ والوقت:</strong> ${escapeHtml(issueDate)} - ${escapeHtml(issueTime)}</p>
        <p><strong>Issued By / بواسطة:</strong> ${escapeHtml(bill.createdBy?.name || "System")}</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background-color: white;">
          <tr style="background-color: #cbd5e0; color: #2d3748;">
            <th style="padding: 12px; border: 1px solid #e2e8f0;">البيان<br>Description</th>
            <th style="padding: 12px; border: 1px solid #e2e8f0;">الكمية<br>Qty</th>
            <th style="padding: 12px; border: 1px solid #e2e8f0;">الإجمالي<br>Gross Amount</th>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">
              <strong>${escapeHtml(arFirst(bill.activityType))}</strong>${descriptionHtml}
            </td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">${bill.quantity}</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">${grossAmount} QAR</td>
          </tr>
        </table>
        
        <div style="margin-top: 20px; text-align: right; border-top: 2px solid #e2e8f0; padding-top: 15px;">
          ${discountHtml}
          <h3 style="color: #2b6cb0; margin: 10px 0; font-size: 22px;">الصافي المستحق / Net Total: QAR ${bill.netAmount} </h3>
        </div>
      </div>
    </div>`,
    });

    if (error) throw new Error(error.message);
    return true;
  },
};
module.exports = BillService;
