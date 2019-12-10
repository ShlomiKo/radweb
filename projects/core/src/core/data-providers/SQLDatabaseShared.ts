
import { EntityDataProvider,  FindOptions } from "../data-interfaces";
import { SQLCommand, SQLConnectionProvider, SQLQueryResult } from "../SQLCommand";
import { Column } from "../column";
import { Entity } from "../entity";
import { FilterConsumerBridgeToSqlRequest } from "../filter/filter-consumer-bridge-to-sql-request";
import { CompoundIdColumn } from "../columns/compound-id-column";
import { FilterBase } from '../filter/filter-interfaces';


class LogSQLConnectionProvider implements SQLConnectionProvider {
  constructor(private origin: SQLConnectionProvider, private allQueries: boolean) { }
  createCommand(): SQLCommand {
    return new LogSQLCommand(this.origin.createCommand(), this.allQueries);
  }
}
class LogSQLCommand implements SQLCommand {
  constructor(private origin: SQLCommand, private allQueries: boolean) {

  }
  args: any = {};
  addParameterToCommandAndReturnParameterName(col: Column<any>, val: any): string {
    let r = this.origin.addParameterToCommandAndReturnParameterName(col, val);
    this.args[r] = val;
    return r;
  }
  async query(sql: string): Promise<SQLQueryResult> {
    if (this.allQueries) {
      console.log('Query:', sql);
      console.log("Arguments:", this.args);
    }
    try {
      return await this.origin.query(sql);
    }
    catch (err) {
      console.log('Query:', sql);
      console.log("Arguments", this.args);
      console.log('Error:', err);
      throw err;
    }
  }
}
// @dynamic
export class ActualSQLServerDataProvider implements EntityDataProvider {
  public static LogToConsole = false;
  constructor(private entity:Entity<any>,  private sql: SQLConnectionProvider) {

    this.sql = ActualSQLServerDataProvider.decorateSqlConnectionProvider(sql);
  }
  static decorateSqlConnectionProvider(sql: SQLConnectionProvider):SQLConnectionProvider {
    return new LogSQLConnectionProvider(sql, ActualSQLServerDataProvider.LogToConsole);
  }
  createDirectSQLCommand() {
    return this.sql.createCommand();
  }
  
  public count(where: FilterBase): Promise<number> {
    let select = 'select count(*) count from ' + this.entity.__getDbName();
    let r = this.sql.createCommand();
    if (where) {
      let wc = new FilterConsumerBridgeToSqlRequest(r);
      where.__applyToConsumer(wc);
      select += wc.where;
    }

    return r.query(select).then(r => {
      return r.rows[0].count;
    });

  }
  find(options?: FindOptions): Promise<any[]> {
    let select = 'select ';
    let colKeys: Column<any>[] = [];
    this.entity.__iterateColumns().forEach(x => {
      if (x.__isVirtual()) {

      }
      else {
        if (colKeys.length > 0)
          select += ', ';
        select += x.__getDbName();
        colKeys.push(x);
      }
    });
    select += ' from ' + this.entity.__getDbName();
    let r = this.sql.createCommand();
    if (options) {
      if (options.where) {
        let where = new FilterConsumerBridgeToSqlRequest(r);
        options.where.__applyToConsumer(where);
        select += where.where;
      }
      if (options.orderBy) {
        let first = true;
        options.orderBy.Segments.forEach(c => {
          if (first) {
            select += ' Order By ';
            first = false;
          }
          else
            select += ', ';
          select += c.column.__getDbName();
          if (c.descending)
            select += ' desc';
        });

      }

      if (options.limit) {

        let page = 1;
        if (options.page)
          page = options.page;
        if (page < 1)
          page = 1;
        select += ' limit ' + options.limit + ' offset ' + (page - 1) * options.limit;
      }
    }

    return r.query(select).then(r => {
      return r.rows.map(y => {
        let result: any = {};
        for (let x in y) {
          let col = colKeys[r.getColumnIndex(x)];
          result[col.jsonName] = col.__getStorage().fromDb(y[x]);
        }
        return result;
      });
    });
  }
  update(id: any, data: any): Promise<any> {


    let r = this.sql.createCommand();
    let f = new FilterConsumerBridgeToSqlRequest(r);
    this.entity.__idColumn.isEqualTo(id).__applyToConsumer(f);
    let statement = 'update ' + this.entity.__getDbName() + ' set ';
    let added = false;
    let resultFilter = this.entity.__idColumn.isEqualTo(id);
    if (data.id != undefined)
      resultFilter = this.entity.__idColumn.isEqualTo(data.id);

    this.entity.__iterateColumns().forEach(x => {
      if (x instanceof CompoundIdColumn) {
        resultFilter = x.resultIdFilter(id, data);
      } if (x.__dbReadOnly()) { }
      else {
        let v = x.__getStorage().toDb(data[x.jsonName]);
        if (v != undefined) {
          if (!added)
            added = true;
          else
            statement += ', ';

          statement += x.__getDbName() + ' = ' + r.addParameterToCommandAndReturnParameterName(x, v);
        }
      }
    });
    statement += f.where;

    return r.query(statement).then(() => {
      return this.find({ where: resultFilter }).then(y => y[0]);
    });


  }
  delete(id: any): Promise<void> {


    let r = this.sql.createCommand();
    let f = new FilterConsumerBridgeToSqlRequest(r);
    this.entity.__idColumn.isEqualTo(id).__applyToConsumer(f);
    let statement = 'delete from ' + this.entity.__getDbName();
    let added = false;

    statement += f.where;

    return r.query(statement).then(() => {
      return this.find({ where: this.entity.__idColumn.isEqualTo(id) }).then(y => y[0]);
    });

  }
  insert(data: any): Promise<any> {


    let r = this.sql.createCommand();
    let f = new FilterConsumerBridgeToSqlRequest(r);


    let cols = '';
    let vals = '';
    let added = false;
    let resultFilter = this.entity.__idColumn.isEqualTo(data[this.entity.__idColumn.jsonName]);

    this.entity.__iterateColumns().forEach((x: any) => {
      if (x instanceof CompoundIdColumn) {
        resultFilter = x.resultIdFilter(undefined, data);
      }
      if (x.__dbReadOnly()) { }

      else {
        let v = x.__getStorage().toDb(data[x.jsonName]);
        if (v != undefined) {
          if (!added)
            added = true;
          else {
            cols += ', ';
            vals += ', ';
          }

          cols += x.__getDbName();
          vals += r.addParameterToCommandAndReturnParameterName(x, v);
        }
      }
    });

    let statement = `insert into ${this.entity.__getDbName()} (${cols}) values (${vals})`;

    return r.query(statement).then(() => {
      return this.find({ where: resultFilter }).then(y => {

        return y[0];
      });
    });
  }

}