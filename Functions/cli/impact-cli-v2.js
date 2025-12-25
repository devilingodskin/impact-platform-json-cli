#!/usr/bin/env node

/**
 * Visual Change Impact Platform - CLI Version 2.0
 * Enhanced with Schema Validation and History
 */

const fs = require('fs');
const path = require('path');

// ===== ЦВЕТА =====
const colors = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
    white: '\x1b[37m', gray: '\x1b[90m',
};

function colorize(text, color) {
    return `${colors[color] || ''}${text}${colors.reset}`;
}

function icon(type) {
    const icons = {
        added: '✚', removed: '✖', modified: '⟳', critical: '⚠',
        high: '◆', medium: '●', low: '○', success: '✓', error: '✗', info: 'ℹ',
    };
    return icons[type] || '•';
}

// ===== ИСТОРИЯ =====
const HISTORY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.impact-cli-history.json');

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        }
    } catch {}
    return [];
}

function saveToHistory(record) {
    const history = loadHistory();
    history.unshift(record);
    
    // Ограничиваем историю 100 записями
    if (history.length > 100) history.splice(100);
    
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function showHistory() {
    const history = loadHistory();
    
    if (history.length === 0) {
        console.log(colorize('\n  История пуста\n', 'gray'));
        return;
    }
    
    console.log(colorize('\n━━━ ИСТОРИЯ СРАВНЕНИЙ ━━━', 'bold'));
    console.log('');
    
    history.slice(0, 20).forEach((record, idx) => {
        const date = new Date(record.timestamp).toLocaleString('ru-RU');
        console.log(colorize(`${idx + 1}. ${record.name || 'Без названия'}`, 'bold'));
        console.log(colorize(`   ${date}`, 'gray'));
        console.log(colorize(`   ${record.fileA} → ${record.fileB}`, 'dim'));
        console.log(colorize(`   Изменений: ${record.summary.total} | Риск: ${record.riskLevel}`, 'cyan'));
        console.log('');
    });
}

// ===== ВАЛИДАЦИЯ СХЕМЫ =====
function validateSchema(data, schema) {
    const errors = [];
    
    function validate(obj, schemaObj, path = '') {
        if (schemaObj.required && Array.isArray(schemaObj.required)) {
            for (const field of schemaObj.required) {
                if (!(field in obj)) {
                    errors.push({
                        path: path ? `${path}.${field}` : field,
                        type: 'missing_required',
                        message: `Отсутствует обязательное поле: ${field}`,
                        severity: 'error',
                    });
                }
            }
        }
        
        if (schemaObj.properties) {
            for (const [key, propSchema] of Object.entries(schemaObj.properties)) {
                const currentPath = path ? `${path}.${key}` : key;
                const value = obj[key];
                
                if (value === undefined) continue;
                
                if (propSchema.type) {
                    const actualType = Array.isArray(value) ? 'array' : typeof value;
                    
                    if (propSchema.type !== actualType && value !== null) {
                        errors.push({
                            path: currentPath,
                            type: 'type_mismatch',
                            message: `Неверный тип: ожидается ${propSchema.type}, получено ${actualType}`,
                            severity: 'error',
                        });
                    }
                }
                
                if (propSchema.enum && !propSchema.enum.includes(value)) {
                    errors.push({
                        path: currentPath,
                        type: 'invalid_enum',
                        message: `Недопустимое значение. Разрешены: ${propSchema.enum.join(', ')}`,
                        severity: 'warning',
                    });
                }
                
                if (propSchema.type === 'object' && propSchema.properties && typeof value === 'object' && value !== null) {
                    validate(value, propSchema, currentPath);
                }
            }
        }
    }
    
    validate(data, schema);
    return errors;
}

function printValidationErrors(errors) {
    if (errors.length === 0) {
        console.log(colorize('\n  ✓ Валидация пройдена успешно\n', 'green'));
        return;
    }
    
    console.log(colorize('\n━━━ ОШИБКИ ВАЛИДАЦИИ ━━━', 'bold'));
    console.log('');
    
    errors.forEach(error => {
        const symbol = error.severity === 'error' ? '✗' : '⚠';
        const color = error.severity === 'error' ? 'red' : 'yellow';
        
        console.log(colorize(`${symbol} ${error.path}`, color));
        console.log(colorize(`  ${error.message}`, 'white'));
        console.log('');
    });
}

// ===== ИМПОРТ АНАЛИЗАТОРА ИЗ ОСНОВНОГО ФАЙЛА =====
function analyzeImpactLocal(changes) {
    const impacts = [];
    
    const CRITICAL_PATTERNS = [
        /^(api[_-]?key|secret|password|token|auth)/i,
        /^(database|db)[_.-](host|url|connection)/i,
        /^(enabled?|active|disabled?)$/i,
    ];
    
    const HIGH_PATTERNS = [
        /timeout/i, /limit/i, /max[_-]?/i, /min[_-]?/i,
        /threshold/i, /retry/i, /^port$/i, /^host$/i,
        /^endpoint$/i, /^url$/i,
    ];
    
    const MEDIUM_PATTERNS = [
        /^name$/i, /^type$/i, /^version$/i, /^format$/i,
        /^encoding$/i, /^locale$/i, /^timezone$/i,
    ];
    
    for (const change of changes) {
        const lastKey = change.path.split('.').pop();
        
        let level = 'low';
        let title = '';
        let description = '';
        let recommendation = '';
        let category = '';
        
        if (CRITICAL_PATTERNS.some(p => p.test(lastKey))) {
            level = 'critical';
            category = 'security';
        } else if (HIGH_PATTERNS.some(p => p.test(lastKey))) {
            level = 'high';
            category = 'performance';
        } else if (MEDIUM_PATTERNS.some(p => p.test(lastKey))) {
            level = 'medium';
            category = 'configuration';
        } else {
            category = 'general';
        }
        
        if (change.type === 'removed') {
            if (level === 'low') level = 'medium';
            title = `Удалено поле: ${lastKey}`;
            description = 'Удаление поля может привести к ошибкам в коде.';
            recommendation = 'Убедитесь, что это поле больше не используется.';
        } else if (change.type === 'added') {
            title = `Добавлено новое поле: ${lastKey}`;
            description = 'Новое поле в конфигурации.';
        } else if (change.type === 'modified') {
            title = `Изменено значение: ${lastKey}`;
            
            if (/timeout/i.test(lastKey)) {
                const oldVal = Number(change.oldValue);
                const newVal = Number(change.newValue);
                if (!isNaN(oldVal) && !isNaN(newVal) && newVal < oldVal) {
                    level = 'high';
                    description = `Таймаут уменьшен с ${oldVal} до ${newVal}.`;
                    recommendation = 'Убедитесь, что новое значение достаточно.';
                }
            }
            
            if (/^(enabled?|active)$/i.test(lastKey)) {
                level = 'critical';
                description = `Изменён флаг активности: ${change.oldValue} → ${change.newValue}`;
                recommendation = 'Критическое изменение. Проверьте влияние!';
            }
            
            if (typeof change.oldValue !== typeof change.newValue) {
                level = 'high';
                description = `Изменён тип данных с ${typeof change.oldValue} на ${typeof change.newValue}`;
            }
        }
        
        if (level !== 'low' || change.type === 'removed') {
            impacts.push({
                level, path: change.path, title,
                description, recommendation, changeType: change.type, category,
            });
        }
    }
    
    return impacts;
}

// ===== АНАЛИТИКА ПО ИСТОРИИ =====
function analyzeHistory(history) {
    if (history.length < 3) return [];
    
    const insights = [];
    const allChanges = history.flatMap(h => h.changes || []);
    const pathCounts = {};
    
    for (const change of allChanges) {
        pathCounts[change.path] = (pathCounts[change.path] || 0) + 1;
    }
    
    const frequentlyChanged = Object.entries(pathCounts)
        .filter(([path, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1]);
    
    if (frequentlyChanged.length > 0) {
        insights.push({
            type: 'frequent_changes',
            paths: frequentlyChanged.slice(0, 5).map(([path, count]) => `${path} (${count}x)`),
        });
    }
    
    return insights;
}

function printHistoryInsights(insights) {
    if (insights.length === 0) return;
    
    console.log(colorize('\n━━━ АНАЛИТИКА ПО ИСТОРИИ ━━━', 'bold'));
    console.log('');
    
    insights.forEach(insight => {
        if (insight.type === 'frequent_changes') {
            console.log(colorize('  Часто изменяемые поля:', 'cyan'));
            insight.paths.forEach(p => {
                console.log(colorize(`    • ${p}`, 'white'));
            });
        }
    });
    console.log('');
}

// ===== ОСТАЛЬНОЙ КОД (парсинг, сравнение, вывод) =====
function parseYAML(content) {
    const lines = content.split('\n');
    const result = {};
    const stack = [{ obj: result, indent: -1 }];
    
    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        
        const indent = line.search(/\S/);
        const match = line.trim().match(/^([^:]+):\s*(.*)$/);
        
        if (match) {
            const [, key, value] = match;
            
            while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }
            
            const parent = stack[stack.length - 1].obj;
            
            if (value) {
                let parsedValue = value.trim();
                if (parsedValue === 'true') parsedValue = true;
                else if (parsedValue === 'false') parsedValue = false;
                else if (!isNaN(parsedValue) && parsedValue !== '') parsedValue = Number(parsedValue);
                else if (parsedValue.startsWith('"') && parsedValue.endsWith('"')) {
                    parsedValue = parsedValue.slice(1, -1);
                }
                parent[key.trim()] = parsedValue;
            } else {
                parent[key.trim()] = {};
                stack.push({ obj: parent[key.trim()], indent });
            }
        }
    }
    
    return result;
}

function loadFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Файл не найден: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.json') {
        return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
        return parseYAML(content);
    } else {
        try {
            return JSON.parse(content);
        } catch {
            throw new Error(`Неподдерживаемый формат: ${ext}`);
        }
    }
}

function compareObjects(objA, objB, path = '') {
    const changes = [];
    const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);
    
    for (const key of allKeys) {
        const currentPath = path ? `${path}.${key}` : key;
        const valueA = objA?.[key];
        const valueB = objB?.[key];
        
        if (!(key in (objA || {}))) {
            changes.push({ type: 'added', path: currentPath, value: valueB });
        } else if (!(key in (objB || {}))) {
            changes.push({ type: 'removed', path: currentPath, value: valueA });
        } else if (typeof valueA === 'object' && typeof valueB === 'object' && 
                   valueA !== null && valueB !== null &&
                   !Array.isArray(valueA) && !Array.isArray(valueB)) {
            changes.push(...compareObjects(valueA, valueB, currentPath));
        } else if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
            changes.push({ type: 'modified', path: currentPath, oldValue: valueA, newValue: valueB });
        }
    }
    
    return changes;
}

function printChanges(changes) {
    // Аналогично оригинальному impact-cli.js
    const added = changes.filter(c => c.type === 'added');
    const removed = changes.filter(c => c.type === 'removed');
    const modified = changes.filter(c => c.type === 'modified');
    
    console.log(colorize('\n━━━ ОБНАРУЖЕННЫЕ ИЗМЕНЕНИЯ ━━━', 'bold'));
    console.log('');
    
    if (added.length > 0) {
        console.log(colorize(`${icon('added')} Добавлено: ${added.length}`, 'green'));
        added.slice(0, 10).forEach(c => {
            console.log(colorize(`  ${c.path}`, 'gray'));
        });
        if (added.length > 10) console.log(colorize(`  ... и ещё ${added.length - 10}`, 'dim'));
        console.log('');
    }
    
    if (modified.length > 0) {
        console.log(colorize(`${icon('modified')} Изменено: ${modified.length}`, 'yellow'));
        modified.slice(0, 10).forEach(c => {
            console.log(colorize(`  ${c.path}`, 'gray'));
        });
        if (modified.length > 10) console.log(colorize(`  ... и ещё ${modified.length - 10}`, 'dim'));
        console.log('');
    }
    
    if (removed.length > 0) {
        console.log(colorize(`${icon('removed')} Удалено: ${removed.length}`, 'red'));
        removed.slice(0, 10).forEach(c => {
            console.log(colorize(`  ${c.path}`, 'gray'));
        });
        if (removed.length > 10) console.log(colorize(`  ... и ещё ${removed.length - 10}`, 'dim'));
        console.log('');
    }
}

function printImpacts(impacts) {
    if (impacts.length === 0) {
        console.log(colorize('\n  ✓ Критических рисков не обнаружено\n', 'green'));
        return;
    }
    
    console.log(colorize('\n━━━ АНАЛИЗ ВЛИЯНИЯ ━━━', 'bold'));
    
    const groups = [
        { items: impacts.filter(i => i.level === 'critical'), label: 'КРИТИЧЕСКИЙ', color: 'red', emoji: '⚠' },
        { items: impacts.filter(i => i.level === 'high'), label: 'Высокий', color: 'yellow', emoji: '◆' },
        { items: impacts.filter(i => i.level === 'medium'), label: 'Средний', color: 'blue', emoji: '●' },
        { items: impacts.filter(i => i.level === 'low'), label: 'Низкий', color: 'gray', emoji: '○' },
    ];
    
    groups.forEach(({ items, label, color, emoji }) => {
        if (items.length === 0) return;
        
        console.log('');
        console.log(colorize(`${emoji} ${label}: ${items.length}`, color));
        items.forEach(impact => {
            console.log('');
            console.log(colorize(`  ${impact.title}`, 'bold'));
            console.log(colorize(`  ${impact.description}`, 'white'));
            if (impact.recommendation) {
                console.log(colorize(`  💡 ${impact.recommendation}`, 'cyan'));
            }
        });
    });
    console.log('');
}

function printSummary(changes, impacts) {
    const added = changes.filter(c => c.type === 'added').length;
    const removed = changes.filter(c => c.type === 'removed').length;
    const modified = changes.filter(c => c.type === 'modified').length;
    
    const critical = impacts.filter(i => i.level === 'critical').length;
    const high = impacts.filter(i => i.level === 'high').length;
    
    console.log(colorize('\n━━━ ИТОГОВЫЙ ОТЧЁТ ━━━', 'bold'));
    console.log('');
    console.log(`  Всего изменений: ${colorize(changes.length, 'bold')}`);
    console.log(`    ${colorize(`+ ${added}`, 'green')} добавлено`);
    console.log(`    ${colorize(`~ ${modified}`, 'yellow')} изменено`);
    console.log(`    ${colorize(`- ${removed}`, 'red')} удалено`);
    console.log('');
    
    let riskLevel = 'Низкий';
    let riskColor = 'green';
    if (critical > 0) { riskLevel = 'КРИТИЧЕСКИЙ'; riskColor = 'red'; }
    else if (high > 0) { riskLevel = 'Высокий'; riskColor = 'yellow'; }
    
    console.log(`  Общий риск: ${colorize(riskLevel, riskColor)}`);
    console.log('');
}

function parseArgs() {
    const args = process.argv.slice(2);
    
    if (args.includes('--history')) {
        showHistory();
        process.exit(0);
    }
    
    if (args.length < 2) {
        console.error(colorize('\nОшибка: Недостаточно аргументов\n', 'red'));
        console.log(`Использование: node impact-cli-v2.js <файл-A> <файл-B> [опции]`);
        console.log(`Опции:\n  --schema=<путь>    Путь к JSON Schema\n  --history          Показать историю\n  --save=<имя>       Сохранить в историю с именем`);
        process.exit(1);
    }
    
    return {
        fileA: args[0],
        fileB: args[1],
        schemaPath: args.find(a => a.startsWith('--schema='))?.split('=')[1],
        saveName: args.find(a => a.startsWith('--save='))?.split('=')[1],
    };
}

function main() {
    try {
        const { fileA, fileB, schemaPath, saveName } = parseArgs();
        
        console.log(colorize('\nVisual Change Impact Platform v2.0', 'cyan'));
        console.log('');
        
        const dataA = loadFile(fileA);
        const dataB = loadFile(fileB);
        
        const changes = compareObjects(dataA, dataB);
        const impacts = analyzeImpactLocal(changes);
        
        // Валидация схемы
        if (schemaPath) {
            const schema = loadFile(schemaPath);
            const errorsA = validateSchema(dataA, schema);
            const errorsB = validateSchema(dataB, schema);
            printValidationErrors([...errorsA, ...errorsB]);
        }
        
        // Аналитика по истории
        const history = loadHistory();
        const insights = analyzeHistory(history);
        printHistoryInsights(insights);
        
        printChanges(changes);
        printImpacts(impacts);
        printSummary(changes, impacts);
        
        // Сохранение в историю
        if (saveName || changes.length > 0) {
            const riskLevel = impacts.some(i => i.level === 'critical') ? 'Критический' :
                            impacts.some(i => i.level === 'high') ? 'Высокий' : 'Низкий';
            
            saveToHistory({
                name: saveName || `${path.basename(fileA)} → ${path.basename(fileB)}`,
                timestamp: new Date().toISOString(),
                fileA: path.basename(fileA),
                fileB: path.basename(fileB),
                changes,
                impacts,
                riskLevel,
                summary: {
                    total: changes.length,
                    added: changes.filter(c => c.type === 'added').length,
                    removed: changes.filter(c => c.type === 'removed').length,
                    modified: changes.filter(c => c.type === 'modified').length,
                },
            });
        }
        
    } catch (error) {
        console.error(colorize(`\n✗ Ошибка: ${error.message}\n`, 'red'));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}