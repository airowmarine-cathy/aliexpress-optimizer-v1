// 部署说明：
// 1. 将此代码复制到 Google Apps Script (https://script.google.com/)
// 2. 点击 "部署" -> "新建部署"
// 3. 选择类型 "Web 应用"
// 4. 执行身份选择 "我 (你的邮箱)"
// 5. 访问权限选择 "所有人" (Anyone)
// 6. 部署后获取 Web App URL，填入前端的设置中

const STORE_LIST_SHEET_NAME = "Store List";

function doGet(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STORE_LIST_SHEET_NAME);
    if (!sheet) {
      return createJsonResponse({ error: "Store List sheet not found" }, 404);
    }
    
    // 获取A列数据，从第2行开始（假设第1行是表头）
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return createJsonResponse({ stores: [] }, 200);
    }
    
    const storeValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const stores = storeValues.map(row => row[0]).filter(name => name !== "");
    
    return createJsonResponse({ stores: stores }, 200);
  } catch (error) {
    return createJsonResponse({ error: error.toString() }, 500);
  }
}

function doPost(e) {
  try {
    // 解析前端传来的 JSON (前端使用 text/plain 发送以避免 CORS preflight)
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || "append"; // "read" or "append"
    const sheetName = payload.sheetName;
    
    if (!sheetName) {
      return createJsonResponse({ error: "Missing sheetName" }, 400);
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      return createJsonResponse({ error: `Sheet '${sheetName}' not found` }, 404);
    }
    
    if (action === "read") {
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < 2 || lastCol === 0) {
        return createJsonResponse({ data: [] }, 200);
      }
      
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      
      const data = values.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return obj;
      });
      
      return createJsonResponse({ data: data }, 200);
    }
    
    // Default action: append
    const data = payload.data; // Array of objects
    if (!data || !Array.isArray(data) || data.length === 0) {
      return createJsonResponse({ error: "Invalid payload data for append" }, 400);
    }
    
    // 获取目标 Sheet 的表头 (第1行)
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      return createJsonResponse({ error: `Target sheet '${sheetName}' has no headers` }, 400);
    }
    
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    // 准备要追加的行数据
    const rowsToAppend = data.map(rowObj => {
      return headers.map(header => {
        let val = rowObj[header];
        if (val === undefined || val === null) {
          return "";
        }
        // 如果是对象或数组，转为 JSON 字符串
        if (typeof val === 'object') {
          return JSON.stringify(val);
        }
        return val;
      });
    });
    
    // 批量追加写入
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
    }
    
    return createJsonResponse({ success: true, message: `Successfully appended ${rowsToAppend.length} rows to ${sheetName}` }, 200);
  } catch (error) {
    return createJsonResponse({ error: error.toString() }, 500);
  }
}

// 辅助函数：返回 JSON 响应
function createJsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
