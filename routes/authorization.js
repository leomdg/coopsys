var moment = require('moment'),
    nodemailer = require('nodemailer');
var DB, Everyone, PATH;

var Authorization = function(db, everyone, path) {
  DB = db;
  Everyone = everyone;
  PATH = path;

  return Authorization;
};

Authorization.get = function(req, res, next) {
  var q = " \
    SELECT a.*, ot.number AS ot_number, c.name AS client, o.name AS otstate \
    FROM authorization a \
    INNER JOIN ot ot ON a.ot_id = ot.id \
    INNER JOIN client c ON a.client_id = c.id \
    INNER JOIN otstate o ON a.otstate_id = o.id \
    WHERE a.otstate_id <= 4 AND a.deleted_at IS NULL \
    ORDER BY a.otstate_id ASC \
  ";

  DB._.query(q, function(err, data) {
    var msg = [];

    data.forEach(function(a) {
      msg.push({
        "id": a.id,
        "req_info_sent_date": a.req_info_sent_date,
        "ot_number": a.ot_number,
        "ot_id": a.ot_id,
        "client": a.client,
        "client_id": a.client_id,
        "otstate": a.otstate,
        "otstate_id": a.otstate_id,
      });
    });

    res.send(msg);
  });
};

Authorization.post = function(req, res, next) {
  DB.Authorization.build(req.body).save().on('success', function(authorization) {
    // Send the news
    DB.News.build({
      name: 'Nueva Autorizaci&oacute;n',
      description: 'Se ha autorizado una O/T',
      related_model: 'authorization',
      related_model_id: authorization.id
    }).save();

    res.send({ "id": authorization.id });
  }).on('error', function(err) {
    res.send(false);
  });
};

Authorization.put = function(req, res, next) {
  DB.Authorization.find({ where: { id: req.body.id } }).on('success', function(a) {
    if (a) {
      req.body.created_at = DB.toMySqlDate(req.body.created_at.substr(0, 10));
      req.body.updated_at = DB.toMySqlDate(req.body.updated_at.substr(0, 10));

      a.updateAttributes(req.body).on('success', function() {
        res.send(req.body);
      }).on('error', function(err) {
        res.send(false);
      });
    }
  });
};

Authorization.setSessionOtId = function(req, res, next) {
  DB.Ot.find({ where: { number: req.params.ot_number } }).on('success', function(ot) {
    if (ot) {
      req.session.auth_selected_ot_id = ot.id;

      DB.Report.find({ where: { ot_id: ot.id } }).on('success', function(r) {
        if (r) {
          DB.Reporttask.findAll({ where: { report_id: r.id } }).on('success', function(reporttasks) {
            DB.Reportphoto.findAll({ where: {
              report_id: r.id,
              deleted_at: null
            } }).on('success', function(reportphotos) {
              var msg = {
                result: true,
                report_tasks: [],
                report_photos: []
              };

              if (reporttasks.length) {
                msg.report_tasks = reporttasks;
              }
              if (reportphotos.length) {
                msg.report_photos = reportphotos;
              }

              res.send(msg);
            });
          });
        } else {
          res.send({ result: false });
        }
      });
    } else {
      res.send({ result: false });
    }
  });
};

Authorization.saveRequirementsReport = function(req, res, next) {
  var ot_id = req.session.auth_selected_ot_id;

  DB.Report.find({ where: { ot_id: ot_id } }).on('success', function(r) {
    if (r) {
      var q = "DELETE FROM reporttask WHERE report_id = " + r.id;

      DB._.query(q, function(err, data) {
        DB.Ottask.findAll({ where: { ot_id: ot_id } }).on('success', function(tasks) {
          tasks.forEach(function(t) {
            DB.Reporttask.build({
              report_id: r.id,
              ottask_id: t.id,
              observation: req.body['task_observation_' + t.id]
            }).save();
          });

          res.send({ result: true, report_id: r.id });
        });
      });
    } else {
      res.send({ result: false });
    }
  });
};

Authorization.addPhotoToReport = function(req, res, next) {
  req.files.photos.forEach(function(ph) {
    DB.Report.find({ where: { ot_id: req.session.auth_selected_ot_id } }).on('success', function(r) {
      DB.Reportphoto.build({
        report_id: r.id,
        path: ph.path.split('/')[5],
        name: ph.name
      }).save().on('success', function() {
        res.send(true);
      }).on('error', function() {
        res.send(false);
      });
    });
  });
};

Authorization.delPhotofromReport = function(req, res, next) {
  DB.Reportphoto.find({ where: { id: req.params.photo_id } }).on('success', function(rp) {
    rp.destroy().on('success', function(rp) {
      res.send({ result: true, id: rp.id });
    }).on('error', function(error) {
      res.send({ result: false, error: error });
    });
  }).on('error', function(error) {
    res.send({ result: false, error: error });
  });
};

Authorization.notifyClient = function(req, res, next) {
  var q = " \
    SELECT ot.*, c.email \
    FROM ot \
    INNER JOIN client c ON ot.client_id = c.id \
    WHERE ot.id = " + req.params.ot_id + " \
  ";

  DB._.query(q, function(err, ot) {
    if (ot.length) {
      DB.Report.find({ where: { ot_id: ot[0].id } }).on('success', function(r) {
        // Get Reporttasks
        // TODO: convert tasks and photos to queries

        var q1 = " \
          SELECT rt.*, ott.name AS name \
          FROM reporttask rt \
          INNER JOIN ottask ott ON rt.ottask_id = ott.id \
          WHERE rt.report_id = " + r.id + " \
        ";

        DB._.query(q1, function(error, tasks) {
          // Build list
          var html = '<h1>Informe de Requerimientos</h1>' +
                     '<h2>Detalle de las tareas pertinentes</h2>' +
                     '<ol>';

          if (tasks.length) {
            var task_style = 'text-decoration:underline; font-weight:bold;';

            tasks.forEach(function(t) {
              html += '<li style="margin:1em;">' +
                      '<span style="' + task_style + '">' + t.name +'</span>: '
                      + t.observation + ' </li>';
            });
          } else {
            html += '<li>La O/T N&ordm; ' + ot[0].number + ' (todav&iacute;a) no posee tareas.</li>';
          }
          html += '</ol>';

          // Get Reportphotos
          DB.Reportphoto.findAll({
            where: { report_id: r.id, deleted_at: null }
          }).on('success', function(photos) {
            // Send e-mail to Client
            var transport = nodemailer.createTransport('SMTP', {
	      service: 'SMTP',
	      host: 'mail.coopertei.com.ar',
              auth: {
                user: 'notificaciones@coopertei.com.ar',
                pass: 'CoopSys'
              }
            });

            var attached_photos = [];
            photos.forEach(function(ph) {
              attached_photos.push({
                fileName: ph.name,
                filePath: PATH.UPLOADS + ph.path
              });
 	      console.log(ph.name + ': ' + PATH.UPLOADS + ph.path);
            });

            var mailOptions = {
              from: 'notificaciones@coopertei.com.ar',
              to: ot[0].email,
	            bcc: 'notificaciones@coopertei.com.ar',
              subject: '[Coopertei] Notificación de Órden de Trabajo',
              replyTo: 'notificaciones@coopertei.com.ar',
              html: html,
              generateTextFromHTML: true,
              attachments: attached_photos
            };

            transport.sendMail(mailOptions, function(error, response) {
              console.log(arguments);
              transport.close();
            });

            DB.Authorization.find({ where: { ot_id: ot[0].id } }).on('success', function(a) {
              if (a) {
                a.updateAttributes({
                  otstate_id: 2,
                  req_info_sent_date: moment().format('DD/MM/YYYY')
                }).on('success', function() {
                  DB.Ot.find({ where: { id: ot[0].id } }).on('success', function(ot) {
                    if (ot) {
                      ot.updateAttributes({ otstate_id: 2 }).on('success', function() {
                        res.send(true);
                      });
                    }
                  });
                }).on('error', function(err) {
                  res.send(false);
                });
              }
            }).on('error', function(err) {
              res.send(false);
            });
          }).on('error', function(err) {
            res.send(false);
          });
        }).on('error', function(err) {
          res.send(false);
        });
      }).on('error', function(err) {
        res.send(false);
      });
    } else {
      res.send(false);
    }
  });
};

Authorization.confirm = function(req, res, next) {
  DB.Authorization.find({ where: { ot_id: req.params.ot_id } }).on('success', function(a) {
    if (a) {
      a.updateAttributes({ otstate_id: 5 }).on('success', function() {
        res.send(true);
      }).on('error', function(err) {
        res.send(false);
      });
    }
  });
};

Authorization.delete = function(req, res, next) {
  DB.Authorization.find({ where: { id: req.params.id } }).on('success', function(a) {
    a.destroy().on('success', function(a) {
      res.send({ "id": a.id });
    }).on('error', function(error) {
      res.send(error);
    });
  }).on('error', function(error) {
    res.send(error);
  });
};

module.exports = Authorization;
