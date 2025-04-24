const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');

// 打开（或创建）SQLite 数据库文件
const db = new Database(path.join(__dirname, 'baby.db'));

// 如果还没建表，你可以顺手执行一次：
db.prepare(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    time TEXT,
    type TEXT,
    details TEXT,
    nutrition TEXT,
    care TEXT,
    remark TEXT
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    height REAL,
    weight REAL,
    remark TEXT
  )
`).run();
db.prepare(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_date ON metrics(date)`).run();

const app = express();
app.use(express.json());        // 添加这一行，才能处理 JSON POST
app.use(express.urlencoded({    // 如果你以后要支持 form 表单，也可以开启
  extended: true
}));

// 把 public 目录当静态资源根，放你的 record.html 等文件
app.use(express.static(path.join(__dirname)));

app.get('/export', async (req, res) => {
  const { start, end } = req.query;

  // 查询事件
  const events = db.prepare(`
    SELECT date, time, type, details, nutrition, care, remark
    FROM events
    WHERE date BETWEEN ? AND ?
    ORDER BY date, time
  `).all(start, end);

  // 查询指标
  const metrics = db.prepare(`
    SELECT date, height, weight, remark AS metric_remark
    FROM metrics
    WHERE date BETWEEN ? AND ?
    ORDER BY date
  `).all(start, end);

  // 生成 Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('报告');
  ws.addRow([
    '日期', '时间', '事件类型', '详情', '营养品', '洗护',
    '身高(cm)', '体重(kg)', '备注(事件)', '备注(指标)'
  ]);

  // 合并输出
  const allDates = Array.from(new Set([
    ...events.map(r => r.date),
    ...metrics.map(r => r.date)
  ])).sort();

  allDates.forEach(date => {
    const evs = events.filter(r => r.date === date);
    const met = metrics.find(r => r.date === date);
    if (evs.length) {
      evs.forEach(ev => {
        ws.addRow([
          date,
          ev.time,
          ev.type,
          ev.details || '',
          ev.nutrition || '',
          ev.care || '',
          met ? met.height : '',
          met ? met.weight : '',
          ev.remark || '',
          met ? met.metric_remark : ''
        ]);
      });
    } else {
      ws.addRow([
        date, '', '', '', '', '',
        met ? met.height : '',
        met ? met.weight : '',
        '', met ? met.metric_remark : ''
      ]);
    }
  });

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition',
    `attachment; filename="report_${start}_${end}.xlsx"`
  );
  await wb.xlsx.write(res);
  res.end();
});

// 新增事件
app.post('/api/events', (req, res) => {
  const { date, time, type, details, nutrition, care, remark } = req.body;
  db.prepare(`
    INSERT INTO events (date, time, type, details, nutrition, care, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(date, time, type, details, nutrition, care, remark);
  res.sendStatus(201);
});

// 获取当日事件
app.get('/api/events', (req, res) => {
  const { date } = req.query;
  const rows = db.prepare(`
    SELECT id, date, time, type, details, nutrition, care, remark
    FROM events
    WHERE date = ?
    ORDER BY
      CASE type
        WHEN 'feeding' THEN 1
        WHEN 'diaper' THEN 2
        WHEN 'nutrition' THEN 3
        WHEN 'care' THEN 4
        ELSE 5
      END ASC,
      time DESC
  `).all(date);
  res.json(rows);
});

// 获取历史事件
app.get('/api/history/events', (req, res) => {
  const { start, end } = req.query;
  const rows = db.prepare(`
    SELECT id, date, time, type, details, nutrition, care, remark
    FROM events
    WHERE date BETWEEN ? AND ?
    ORDER BY date DESC, 
      CASE type
        WHEN 'feeding' THEN 1
        WHEN 'diaper' THEN 2
        WHEN 'nutrition' THEN 3
        WHEN 'care' THEN 4
        ELSE 5
      END ASC,
      time DESC
  `).all(start, end);
  res.json(rows);
});

// 获取历史指标
app.get('/api/history/metrics', (req, res) => {
  const { start, end } = req.query;
  const rows = db.prepare(`
    SELECT date, height, weight, remark
    FROM metrics
    WHERE date BETWEEN ? AND ?
    ORDER BY date DESC
  `).all(start, end);
  res.json(rows);
});

// 获取某日指标
app.get('/api/metrics', (req, res) => {
  const { date } = req.query;
  const row = db.prepare(`
    SELECT date, height, weight, remark
    FROM metrics
    WHERE date = ?
  `).get(date);
  res.json(row || {});
});

// 新增或更新指标
app.post('/api/metrics', (req, res) => {
  const { date, height, weight, remark } = req.body;
  const old = db.prepare('SELECT * FROM metrics WHERE date = ?').get(date);

  if (old) {
    // 只更新有传值的字段
    const newHeight = (height !== undefined && height !== null && height !== '') ? height : old.height;
    const newWeight = (weight !== undefined && weight !== null && weight !== '') ? weight : old.weight;
    const newRemark = (remark !== undefined && remark !== null && remark !== '') ? remark : old.remark;

    db.prepare(`
      UPDATE metrics SET height = ?, weight = ?, remark = ?
      WHERE date = ?
    `).run(newHeight, newWeight, newRemark, date);
  } else {
    db.prepare(`
      INSERT INTO metrics (date, height, weight, remark)
      VALUES (?, ?, ?, ?)
    `).run(date, height || null, weight || null, remark || '');
  }
  res.sendStatus(201);
});


// 生成报告数据
app.get('/api/report', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: '缺少 start 或 end 参数' });
  }

  // 1. 生成日期列表
  const labels = [];
  let cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    labels.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  // 2. 拉体重和身高数据
  const weights = labels.map(date => {
    const row = db.prepare(
      'SELECT weight FROM metrics WHERE date = ?'
    ).get(date);
    return row ? row.weight : null;
  });

  const heights = labels.map(date => {
    const row = db.prepare(
      'SELECT height FROM metrics WHERE date = ?'
    ).get(date);
    return row ? row.height : null;
  });

  // 3. 返回
  res.json({ labels, weights, heights });
});

// 删除指定项（同时删除该日期的指标）
app.delete('/api/events/:id', (req, res) => {
  const id = req.params.id;
  // 先查出该事件的日期
  const ev = db.prepare('SELECT date FROM events WHERE id = ?').get(id);
  if (!ev) return res.sendStatus(404);

  // 删除事件
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(id);

  // 检查该日期是否还有其他事件
  const count = db.prepare('SELECT COUNT(*) AS n FROM events WHERE date = ?').get(ev.date).n;
  if (count === 0) {
    // 如果该日期没有其他事件了，删除对应的指标
    db.prepare('DELETE FROM metrics WHERE date = ?').run(ev.date);
  }

  if (info.changes > 0) {
    res.sendStatus(204);
  } else {
    res.sendStatus(404);
  }
});
// 启动服务
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
