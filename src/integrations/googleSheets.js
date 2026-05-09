import { google } from 'googleapis';
import { rowsForGoogleSheets } from '../output/sheetsCsv.js';

const DEFAULT_SHEET_NAME = '電子書特價日報';

async function getSheetsClient() {
  const credentialsText = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsText) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is required when GOOGLE_SHEET_ID is set.');
  }

  const credentials = JSON.parse(credentialsText);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

async function ensureSheet(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = spreadsheet.data.sheets?.find(sheet => sheet.properties?.title === sheetName);
  if (existing) return existing.properties.sheetId;

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: {
                frozenRowCount: 1
              }
            }
          }
        }
      ]
    }
  });

  return response.data.replies?.[0]?.addSheet?.properties?.sheetId;
}

export async function writeGoogleSheet(rows, spreadsheetId, sheetName = process.env.GOOGLE_SHEET_TAB || DEFAULT_SHEET_NAME) {
  const sheets = await getSheetsClient();
  const values = rowsForGoogleSheets(rows);
  const sheetId = await ensureSheet(sheets, spreadsheetId, sheetName);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:Z`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.0, green: 1.0, blue: 0.53 },
                horizontalAlignment: 'CENTER',
                textFormat: { bold: true, foregroundColor: { red: 0.04, green: 0.04, blue: 0.04 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)'
          }
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 21
            }
          }
        },
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: values.length,
                startColumnIndex: 0,
                endColumnIndex: values[0].length
              }
            }
          }
        }
      ]
    }
  });
}
